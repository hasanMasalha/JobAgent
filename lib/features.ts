// Features that exist in code but haven't launched. A flag here turns off
// every way into the feature, not just its button — offering a flow that
// can only end in an error is worse than not offering it.

/**
 * Google Calendar interview scheduling. Off until it launches. Gates:
 * - Profile: the "Google Calendar" connect section and its status check
 * - Applications: the "add the interview to your calendar" dialog that
 *   opens after setting a status to Interviewing
 * - Chat assistant: the schedule_interview tool (not offered to the model)
 * - /api/auth/google (connect), its callback, and /api/calendar/create-event
 *   (404 while off; disconnect and status stay available)
 */
export const GOOGLE_CALENDAR_ENABLED = false;
