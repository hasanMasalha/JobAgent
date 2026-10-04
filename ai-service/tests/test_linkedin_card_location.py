"""A LinkedIn search card's location must be the location alone. The posted
time and badges share its metadata block, and reading the whole block stored
values like "New York, NY17 hours ago"."""
import pytest
from bs4 import BeautifulSoup

from linkedin_fetcher import _card_location


def _card(metadata: str) -> BeautifulSoup:
    html = (
        '<div class="base-card base-search-card job-search-card">'
        '<div class="base-search-card__info">'
        '<h3 class="base-search-card__title">Backend Engineer</h3>'
        '<h4 class="base-search-card__subtitle"><a href="#">Acme</a></h4>'
        f'<div class="base-search-card__metadata">{metadata}</div>'
        "</div></div>"
    )
    return BeautifulSoup(html, "html.parser").find("div")


@pytest.mark.parametrize(
    "metadata, expected",
    [
        (
            (
                '<span class="job-search-card__location">New York, NY</span>'
                '<time class="job-search-card__listdate">17 hours ago</time>'
            ),
            "New York, NY",
        ),
        (
            (
                '<span class="job-search-card__location">United States</span>'
                '<div class="job-posting-benefits"><span class="job-posting-benefits__text">'
                "Be an early applicant</span></div>"
                '<time class="job-search-card__listdate--new">1 hour ago</time>'
            ),
            "United States",
        ),
        (
            '<span class="job-search-card__location">\n   Tel Aviv-Yafo,\n  Tel Aviv District, Israel\n </span>',
            "Tel Aviv-Yafo, Tel Aviv District, Israel",
        ),
    ],
)
def test_location_only(metadata, expected):
    assert _card_location(_card(metadata)) == expected


def test_no_location_is_empty_not_the_metadata_block():
    card = _card('<time class="job-search-card__listdate">3 hours ago</time>')
    assert _card_location(card) == ""
