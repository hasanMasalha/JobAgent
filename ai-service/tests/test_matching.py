from company_scraper import is_israeli_job


def test_tel_aviv_is_israeli():
    assert is_israeli_job({"location": "Tel Aviv"}) is True


def test_new_york_is_not_israeli():
    assert is_israeli_job({"location": "New York"}) is False


def test_empty_location_with_known_israeli_company_is_israeli():
    assert is_israeli_job({"location": "", "known_israeli_company": True}) is True


def test_empty_location_unknown_company_is_not_israeli():
    assert is_israeli_job({"location": ""}) is False


def test_haifa_is_israeli():
    assert is_israeli_job({"location": "Haifa, Israel"}) is True


def test_dotcoil_url_with_empty_location_is_israeli():
    assert is_israeli_job({"location": "", "url": "https://example.co.il/jobs/123"}) is True
