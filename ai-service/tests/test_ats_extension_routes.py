"""routes/ats_extension: what the extension gets to fill an ATS form itself.
The database and Claude are faked; the rules are the real ones."""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import routes.ats_extension as ext

APP_ROW = {
    "id": "app-1", "status": "pending_extension", "tailored_cv": "", "cover_letter": "",
    "resolved_answers": None, "title": "Engineer", "company": "Acme",
    "url": "https://jobs.lever.co/acme/123", "apply_url": None,
}
USER_ROW = {"first_name": "Dana", "last_name": "Levi", "email": "dana@example.com", "phone": "+972 50-234-5678",
            "city": "Tel Aviv", "application_details_confirmed_at": None}
CV_ROW = {"raw_text": "Dana Levi — backend engineer, 6 years of Python.", "source": "generated",
          "original_file": None, "original_filename": None, "original_mime_type": None}


class FakeConn:
    def __init__(self, app_row):
        self.app_row = app_row
        self.updates = []

    async def fetchrow(self, sql, *args):
        if 'FROM "Application" a JOIN "Job"' in sql:
            return self.app_row if self.app_row and args[1] == "user-1" else None
        if 'FROM "User"' in sql:
            return USER_ROW
        if 'FROM "CV"' in sql:
            return CV_ROW
        raise AssertionError(sql)

    async def fetch(self, sql, *args):
        return []

    async def execute(self, sql, *args):
        self.updates.append((sql, args))

    async def close(self):
        pass


@pytest.fixture
def setup(monkeypatch):
    state = {"conn": FakeConn(dict(APP_ROW)), "claude_calls": []}

    async def connect(_dsn):
        return state["conn"]

    async def fake_claude(question, cv_text):
        state["claude_calls"].append(question)
        return f"Because of {question[:10]}"

    monkeypatch.setenv("DATABASE_URL", "postgres://fake")
    monkeypatch.setattr(ext.asyncpg, "connect", connect)
    monkeypatch.setattr(ext, "claude_answer", fake_claude)
    app = FastAPI()
    app.include_router(ext.router)
    state["client"] = TestClient(app)
    return state


def post(state, path, **body):
    body.setdefault("user_id", "user-1")
    body.setdefault("application_id", "app-1")
    return state["client"].post(path, json=body).json()


QUESTIONS = [
    {"id": "name", "label": "Full name", "kind": "text", "role": "full_name", "required": True},
    {"id": "why", "label": "Why do you want to join Acme?", "kind": "long_text", "required": True},
    {"id": "salary", "label": "Expected annual salary (USD)", "kind": "text", "required": True},
]


def test_resolves_facts_from_profile_open_ended_from_claude_and_reports_missing(setup):
    r = post(setup, "/resolve-answers", questions=QUESTIONS)

    by_id = {a["id"]: a for a in r["answers"]}
    assert by_id["name"] == {"id": "name", "source": "profile", "value": "Dana Levi"}
    assert by_id["why"]["source"] == "claude"
    assert r["missing"] == [{"id": "salary", "label": "Expected annual salary (USD)"}]
    assert setup["claude_calls"] == ["Why do you want to join Acme?"]


def test_claude_answers_are_cached_on_the_application(setup):
    post(setup, "/resolve-answers", questions=QUESTIONS)
    sql, args = setup["conn"].updates[0]
    assert "resolved_answers" in sql
    stored = json.loads(args[0])
    assert list(stored["claude"]) == ["why do you want to join acme?"]

    # The form is reloaded: the cached answer is used, Claude isn't called.
    setup["conn"].app_row["resolved_answers"] = args[0]
    setup["claude_calls"].clear()
    r = post(setup, "/resolve-answers", questions=QUESTIONS)
    assert setup["claude_calls"] == []
    assert any(a["id"] == "why" and a["source"] == "claude" for a in r["answers"])


def test_claude_answers_are_capped_per_application(setup):
    many = [{"id": f"q{i}", "label": f"Why does topic {i} interest you?", "kind": "long_text", "required": True}
            for i in range(ext.MAX_CLAUDE_ANSWERS + 2)]
    r = post(setup, "/resolve-answers", questions=many)
    assert len(setup["claude_calls"]) == ext.MAX_CLAUDE_ANSWERS
    assert len(r["missing"]) == 2


@pytest.mark.parametrize("path", ["/resolve-answers", "/ats-package", "/ats-package/cv"])
def test_someone_elses_application_is_not_found(setup, path):
    assert post(setup, path, user_id="user-2", questions=[]) == {"error": "not_found"}


@pytest.mark.parametrize("status", ["applied", "needs_manual", "manual"])
def test_a_finished_application_is_closed(setup, status):
    setup["conn"].app_row["status"] = status
    assert post(setup, "/ats-package") == {"error": "not_open", "status": status}
    assert setup["claude_calls"] == []


def test_package_names_the_ats_and_the_form_to_open(setup):
    r = post(setup, "/ats-package")
    assert r["ats"] == "lever"
    assert r["form_url"] == "https://jobs.lever.co/acme/123/apply"
    assert (r["job_title"], r["company"]) == ("Engineer", "Acme")


@pytest.mark.parametrize(
    "url, apply_url, form, ats",
    [
        ("https://www.linkedin.com/jobs/view/1", "https://job-boards.greenhouse.io/acme/jobs/9",
         "https://job-boards.greenhouse.io/acme/jobs/9", "greenhouse"),
        ("https://jobs.ashbyhq.com/acme/abc", None, "https://jobs.ashbyhq.com/acme/abc", "ashby"),
        ("https://jobs.lever.co/acme/1/apply", None, "https://jobs.lever.co/acme/1/apply", "lever"),
        ("https://example.com/careers/1", None, "https://example.com/careers/1", "unknown"),
    ],
)
def test_form_url(url, apply_url, form, ats):
    assert ext.form_url(url, apply_url) == (form, ats)


def test_cv_is_the_file_the_application_sends(setup):
    r = post(setup, "/ats-package/cv")
    assert r["filename"] == "Dana_Levi_cv.pdf"
    assert r["mime_type"] == "application/pdf"
    assert r["base64"]


def test_form_answers_reads_the_form_and_answers_it(setup, monkeypatch):
    from answer_resolver import Question

    async def fake_questions(ats, url):
        assert ats == "lever"
        return [
            Question(id="name", label="Full name", kind="text", role="full_name", required=True),
            Question(id="why", label="Why Acme?", kind="long_text", required=True),
            Question(id="auth", label="Authorized to work in the UK?", kind="boolean", required=True),
        ]

    monkeypatch.setattr(ext, "form_questions", fake_questions)
    r = post(setup, "/form-answers")

    assert r["supported"] is True and r["ats"] == "lever"
    assert [q["id"] for q in r["questions"]] == ["name", "why", "auth"]
    assert {a["id"]: a["source"] for a in r["answers"]} == {"name": "profile", "why": "claude"}
    assert r["missing"] == [{"id": "auth", "label": "Authorized to work in the UK?"}]


def test_form_answers_unsupported_ats(setup, monkeypatch):
    async def none(ats, url):
        return None

    monkeypatch.setattr(ext, "form_questions", none)
    r = post(setup, "/form-answers")
    assert r == {"supported": False, "ats": "lever", "form_url": "https://jobs.lever.co/acme/123/apply"}
    assert setup["claude_calls"] == []
