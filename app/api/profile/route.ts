import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { phoneProblem } from "@/lib/phone";
import { db } from "@/lib/db";
import { parseWorkCountries } from "@/lib/countries";
import { parseSalary } from "@/lib/salary";

export async function GET(_req: NextRequest) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [cvRows, dbUser, rateRows] = await Promise.all([
      db.$queryRaw<{ id: string; clean_summary: string | null; skills_json: string | null; updated_at: Date; raw_text: string }[]>`
        SELECT id, clean_summary, skills_json, updated_at, raw_text
        FROM "CV" WHERE user_id = ${user.id} LIMIT 1
      `,
      db.user.findUnique({
        where: { id: user.id },
        select: {
          google_connected: true,
          email_notifications: true,
          first_name: true,
          last_name: true,
          phone: true,
          city: true,
          currentCompany: true,
          linkedin_url: true,
          github_url: true,
          portfolio_url: true,
          salary_amount: true,
          salary_currency: true,
          salary_period: true,
          salary_convert_currency: true,
          notice_period: true,
          years_of_experience: true,
          highest_education: true,
          willing_to_relocate: true,
          application_details_confirmed_at: true,
          work_countries: true,
          sponsorship_later_countries: true,
          work_auth_confirmed_at: true,
        },
      }),
      // For the Profile's conversion example only; the AI service reads its own.
      db.exchangeRate.findMany({ select: { currency: true, per_eur: true, rate_date: true } }),
    ]);

    // Run preferences query separately so a missing column never causes 500
    let prefRows: { titles: string[]; locations: string[]; remote_ok: boolean; work_modes: string[]; min_salary: number | null }[] = [];
    try {
      prefRows = await db.$queryRaw`
        SELECT titles, locations, remote_ok, work_modes, min_salary
        FROM "JobPreference" WHERE user_id = ${user.id} LIMIT 1
      `;
    } catch {
      try {
        const rows = await db.$queryRaw<{ titles: string[]; locations: string[]; remote_ok: boolean; min_salary: number | null }[]>`
          SELECT titles, locations, remote_ok, min_salary
          FROM "JobPreference" WHERE user_id = ${user.id} LIMIT 1
        `;
        prefRows = rows.map((r) => ({ ...r, work_modes: [] }));
      } catch {
        prefRows = [];
      }
    }

    return NextResponse.json({
      cv: cvRows[0] ?? null,
      preferences: prefRows[0] ?? null,
      google_connected: dbUser?.google_connected ?? false,
      email_notifications: dbUser?.email_notifications ?? true,
      // Easy Apply defaults
      first_name: dbUser?.first_name ?? null,
      last_name: dbUser?.last_name ?? null,
      phone: dbUser?.phone ?? null,
      city: dbUser?.city ?? null,
      currentCompany: dbUser?.currentCompany ?? null,
      linkedin_url: dbUser?.linkedin_url ?? null,
      github_url: dbUser?.github_url ?? null,
      portfolio_url: dbUser?.portfolio_url ?? null,
      // Expected salary, gross (ai-service/salary.py). All three or none.
      salary_amount: dbUser?.salary_amount ?? null,
      salary_currency: dbUser?.salary_currency ?? null,
      salary_period: dbUser?.salary_period ?? null,
      salary_convert_currency: dbUser?.salary_convert_currency ?? false,
      exchange_rates: rateRows.length
        ? {
            date: rateRows.reduce((d, r) => (r.rate_date < d ? r.rate_date : d), rateRows[0].rate_date),
            per_eur: Object.fromEntries(rateRows.map((r) => [r.currency, r.per_eur])),
          }
        : null,
      // Null when the user has no answer — never a made-up one. The Profile
      // form supplies its own starting values.
      notice_period: dbUser?.notice_period ?? null,
      years_of_experience: dbUser?.years_of_experience ?? null,
      highest_education: dbUser?.highest_education ?? null,
      willing_to_relocate: dbUser?.willing_to_relocate ?? null,
      // Where the user can work (ISO codes, "EU"), and where that needs
      // sponsorship later. Confirmed once saved: only then is an unlisted
      // country answered "no" (ai-service/work_authorisation.py).
      work_countries: dbUser?.work_countries ?? [],
      sponsorship_later_countries: dbUser?.sponsorship_later_countries ?? [],
      work_auth_confirmed: !!dbUser?.work_auth_confirmed_at,
      // False until the user has saved or approved the answers above. Until
      // then the extension isn't given them (see /api/apply/check-pending).
      application_details_confirmed: !!dbUser?.application_details_confirmed_at,
    });
  } catch (err) {
    console.error("[profile GET]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      first_name, last_name, phone, city, currentCompany,
      linkedin_url, github_url, portfolio_url,
      notice_period, years_of_experience,
      highest_education, willing_to_relocate, confirm_application_details,
    } = body;

    // Application forms ask for the phone's country and the AI service takes
    // it from the number (phone_country.py), so it has to name its country.
    const badPhone = phone !== undefined ? phoneProblem(phone) : null;
    if (badPhone) {
      return NextResponse.json({ error: "invalid_phone", message: badPhone }, { status: 400 });
    }

    // Expected salary: amount, currency and period together, or none.
    let salary: { salary_amount: number | null; salary_currency: string | null; salary_period: string | null } | null = null;
    if (body.salary_amount !== undefined) {
      const parsed = parseSalary(body);
      if (parsed && "error" in parsed) {
        return NextResponse.json({ error: "invalid_salary", message: parsed.error }, { status: 400 });
      }
      salary = parsed
        ? { salary_amount: parsed.amount, salary_currency: parsed.currency, salary_period: parsed.period }
        : { salary_amount: null, salary_currency: null, salary_period: null };
    }
    if (body.salary_convert_currency !== undefined && typeof body.salary_convert_currency !== "boolean") {
      return NextResponse.json({ error: "invalid_salary", message: "Invalid conversion setting." }, { status: 400 });
    }

    // Right to work. The old "Authorized to work in Israel?" / sponsorship
    // yes-nos aren't accepted any more: work_authorized and
    // requires_sponsorship stay as they were, for Israel until the list is saved.
    let workAuth: { work_countries: string[]; sponsorship_later_countries: string[]; work_auth_confirmed_at: Date | null } | null = null;
    if (body.work_countries !== undefined) {
      const countries = parseWorkCountries(body.work_countries);
      const later = parseWorkCountries(body.sponsorship_later_countries ?? []);
      if (!countries || !later || later.some((c) => !countries.includes(c))) {
        return NextResponse.json(
          { error: "invalid_work_countries", message: "Choose countries from the list. Sponsorship can only be needed in a country you listed." },
          { status: 400 },
        );
      }
      // Saving the list is what makes "not on it" an answer. An empty list
      // isn't "nowhere": it's no answer, and those questions stop.
      workAuth = {
        work_countries: countries,
        sponsorship_later_countries: later,
        work_auth_confirmed_at: countries.length ? new Date() : null,
      };
    }

    // Saving the application details, or approving them on the apply review
    // screen, is what makes them the user's own answers.
    const APPLICATION_DETAIL_KEYS = [
      "notice_period", "years_of_experience", "highest_education", "willing_to_relocate", "work_countries",
    ];
    const confirmsDetails =
      confirm_application_details === true || APPLICATION_DETAIL_KEYS.some((k) => body[k] !== undefined);

    // Approving on the review screen confirms the list it showed, if there is one.
    if (!workAuth && confirm_application_details === true) {
      const current = await db.user.findUnique({ where: { id: user.id }, select: { work_countries: true } });
      if (current?.work_countries.length) {
        workAuth = {
          work_countries: current.work_countries,
          sponsorship_later_countries: [],
          work_auth_confirmed_at: new Date(),
        };
      }
    }

    await db.user.update({
      where: { id: user.id },
      data: {
        first_name,
        last_name,
        phone,
        city,
        currentCompany,
        linkedin_url,
        github_url,
        portfolio_url,
        ...(salary ?? {}),
        ...(typeof body.salary_convert_currency === "boolean" ? { salary_convert_currency: body.salary_convert_currency } : {}),
        notice_period,
        years_of_experience,
        highest_education,
        willing_to_relocate,
        ...(workAuth
          ? {
              work_countries: workAuth.work_countries,
              work_auth_confirmed_at: workAuth.work_auth_confirmed_at,
              ...(body.work_countries !== undefined ? { sponsorship_later_countries: workAuth.sponsorship_later_countries } : {}),
            }
          : {}),
        ...(confirmsDetails ? { application_details_confirmed_at: new Date() } : {}),
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[profile PATCH]", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
