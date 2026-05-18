from unittest.mock import MagicMock, patch

import numpy as np


def test_embed_returns_list_of_384_floats():
    fake_vector = np.zeros(384, dtype=np.float32)
    mock_model = MagicMock()
    mock_model.encode.return_value = fake_vector

    with patch("embedder._get_model", return_value=mock_model):
        from embedder import embed
        result = embed("software engineer Tel Aviv")

    assert isinstance(result, list)
    assert len(result) == 384
    assert all(isinstance(v, float) for v in result)


def test_cv_extraction_prompt_contains_required_fields():
    mock_client = MagicMock()
    mock_message = MagicMock()
    mock_message.content = [MagicMock(text='{"skills": [], "job_titles": [], "years_experience": 0, "seniority_level": "junior", "clean_summary": ""}')]
    mock_client.messages.create.return_value = mock_message

    fake_vector = [0.0] * 384

    with (
        patch("routes.cv._client", mock_client),
        patch("routes.cv.embed", return_value=fake_vector),
    ):
        import asyncio

        from routes.cv import ProcessCVRequest, process_cv

        req = ProcessCVRequest(raw_text="John Doe, Python developer, 3 years", user_id="u1")
        asyncio.run(process_cv(req))

    call_args = mock_client.messages.create.call_args
    prompt_content = call_args.kwargs["messages"][0]["content"]
    assert "skills" in prompt_content
    assert "years_experience" in prompt_content
    assert "seniority_level" in prompt_content
    assert "clean_summary" in prompt_content
