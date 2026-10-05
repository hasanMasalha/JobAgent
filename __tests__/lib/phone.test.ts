import { phoneProblem } from "@/lib/phone";

// Profile accepts exactly the numbers the AI service can place in a country
// (ai-service/tests/test_phone_country.py has the same cases).
describe("phoneProblem", () => {
  it.each([
    ["+972 50-234-5678"],
    ["+972501234567"], // not strictly valid; +972 is Israel only
    ["050-1234567"], // Profile's old local format
    ["+44 7400 123456"],
    ["0044 7400 123456"],
    ["+44 7911 123456"], // Guernsey
    ["+1 202 555 0123"],
    ["+1 (213) 373-4253"],
    ["+1 416 555 0199"], // Canada
    ["+49 1512 3456789"],
    [""],
    [null],
  ])("accepts %p", (raw) => {
    expect(phoneProblem(raw)).toBeNull();
  });

  it.each([
    ["07400 123456", /country code/], // a UK number without +44
    ["2025550123", /country code/],
    ["+44 7700 900123", /which country/], // +44 is shared; invalid number
    ["+1 555 555 5555", /which country/],
    ["not a number", /country code/],
  ])("rejects %p", (raw, message) => {
    expect(phoneProblem(raw)).toMatch(message);
  });
});
