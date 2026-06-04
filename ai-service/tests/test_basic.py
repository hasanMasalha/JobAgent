def test_is_israeli_job_tel_aviv():
    from company_scraper import is_israeli_job
    assert is_israeli_job({'location': 'Tel Aviv, Israel'}) is True

def test_is_israeli_job_new_york():
    from company_scraper import is_israeli_job
    assert is_israeli_job({'location': 'New York, USA'}) is False

def test_is_israeli_job_known_company():
    from company_scraper import is_israeli_job
    assert is_israeli_job({
        'location': '',
        'known_israeli_company': True
    }) is True

def test_embed_returns_list():
    from unittest.mock import patch, MagicMock

    mock_model = MagicMock()
    mock_model.encode.return_value.tolist.return_value = [0.1] * 384

    with patch('embedder._get_model', return_value=mock_model):
        from embedder import embed
        result = embed('software engineer')
        assert isinstance(result, list)
        assert len(result) == 384
