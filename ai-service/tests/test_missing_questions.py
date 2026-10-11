"""A form that stops on questions the user hasn't answered keeps them on the
application (missing_questions), so the Applications page can ask each one
and save the answer for that exact question."""

import asyncio
import json

from ashby_form import question_options
from routes import ats_apply
from routes.ats_form_fill import _missing_answers_result


def test_missing_answers_result_lists_each_question_with_its_options():
    r = _missing_answers_result(
        ["How did you hear about ElevenLabs?", "Location"],
        ["_systemfield_name"],
        {"How did you hear about ElevenLabs?": ["LinkedIn", "A friend", "Other"]},
    )
    assert r["error"] == "missing_answers"
    assert r["missing_questions"] == [
        {"question": "How did you hear about ElevenLabs?", "options": ["LinkedIn", "A friend", "Other"]},
        {"question": "Location", "options": []},
    ]


def test_message_sends_the_user_to_the_applications_page_not_profile():
    msg = _missing_answers_result(["Notice period"], [])["message"]
    assert "Applications page" in msg
    # Profile → Saved answers can't add an answer to a new question.
    assert "Profile" not in msg


def test_ashby_question_options_by_title():
    posting = {"applicationForm": {"sections": [{"fieldEntries": [
        {"field": {"path": "a", "type": "ValueSelect", "title": "How did you hear about us?",
                   "selectableValues": [{"label": "LinkedIn"}, {"label": "Other"}]}},
        {"field": {"path": "b", "type": "Boolean", "title": "Willing to work in the office 3 days a week?"}},
        {"field": {"path": "c", "type": "String", "title": "Notice period"}},
    ]}]}}
    assert question_options(posting) == {
        "How did you hear about us?": ["LinkedIn", "Other"],
        "Willing to work in the office 3 days a week?": ["Yes", "No"],
    }


class _Conn:
    def __init__(self):
        self.calls = []

    def transaction(self):
        conn = self

        class _Tx:
            async def __aenter__(self):
                return conn

            async def __aexit__(self, *_):
                return False

        return _Tx()

    async def execute(self, sql, *args):
        self.calls.append((sql, args))

    async def fetchrow(self, sql, *args):
        return None


def test_needs_manual_stores_the_missing_questions():
    conn = _Conn()
    questions = [{"question": "Notice period", "options": []}]
    asyncio.run(ats_apply._mark_needs_manual(conn, "app-1", "msg", questions))
    sql, args = conn.calls[0]
    assert "missing_questions" in sql
    assert json.loads(args[2]) == questions


def test_needs_manual_for_another_reason_stores_none():
    conn = _Conn()
    asyncio.run(ats_apply._mark_needs_manual(conn, "app-1", "timeout"))
    assert conn.calls[0][1][2] is None
