import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase.server";
import { phoneProblem } from "@/lib/phone";
import { db } from "@/lib/db";

export async function GET(_req: NextRequest) {
  try {
    const supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [cvRows, dbUser] = await Promise.all([
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
          expected_salary: true,
          notice_period: true,
          years_of_experience: true,
          highest_education: true,
          work_authorized: true,
          requires_sponsorship: true,
          willing_to_relocate: true,
          application_details_confirmed_at: true,
        },
      }),
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
      expected_salary: dbUser?.expected_salary ?? null,
      // Null when the user has no answer — never a made-up one. The Profile
      // form supplies its own starting values.
      notice_period: dbUser?.notice_period ?? null,
      years_of_experience: dbUser?.years_of_experience ?? null,
      highest_education: dbUser?.highest_education ?? null,
      work_authorized: dbUser?.work_authorized ?? null,
      requires_sponsorship: dbUser?.requires_sponsorship ?? null,
      willing_to_relocate: dbUser?.willing_to_relocate ?? null,
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
      expected_salary, notice_period, years_of_experience,
      highest_education, work_authorized, requires_sponsorship,
      willing_to_relocate, confirm_application_details,
    } = body;

    // Application forms ask for the phone's country and the AI service takes
    // it from the number (phone_country.py), so it has to name its country.
    const badPhone = phone !== undefined ? phoneProblem(phone) : null;
    if (badPhone) {
      return NextResponse.json({ error: "invalid_phone", message: badPhone }, { status: 400 });
    }

    // Saving the application details, or approving them on the apply review
    // screen, is what makes them the user's own answers.
    const APPLICATION_DETAIL_KEYS = [
      "notice_period", "years_of_experience", "highest_education",
      "work_authorized", "requires_sponsorship", "willing_to_relocate",
    ];
    const confirmsDetails =
      confirm_application_details === true || APPLICATION_DETAIL_KEYS.some((k) => body[k] !== undefined);

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
        expected_salary,
        notice_period,
        years_of_experience,
        highest_education,
        work_authorized,
        requires_sponsorship,
        willing_to_relocate,
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
