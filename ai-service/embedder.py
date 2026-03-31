from sentence_transformers import SentenceTransformer

_model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")


def embed(text: str) -> list[float]:
    return _model.encode(text).tolist()
