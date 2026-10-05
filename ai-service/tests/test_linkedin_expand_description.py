"""The "Show more" click on a LinkedIn job page must not wait on Playwright's
actionability checks: logged out, a sign-in prompt covers the page and a mouse
click waits its full timeout (2026-10-04 timing run: ~125s per job page, and
LinkedIn only reached Israel). Hidden matches are skipped; a visible one gets a
DOM click."""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import linkedin_fetcher
from linkedin_fetcher import _expand_description


def _button(visible: bool, click_error: Exception | None = None):
    btn = MagicMock()
    btn.is_visible = AsyncMock(return_value=visible)
    btn.evaluate = AsyncMock(side_effect=click_error)
    btn.click = AsyncMock()
    btn.scroll_into_view_if_needed = AsyncMock()
    return btn


def _page(buttons: dict):
    page = MagicMock()
    page.query_selector = AsyncMock(side_effect=lambda sel: buttons.get(sel))
    page.wait_for_timeout = AsyncMock()
    return page


def test_hidden_matches_are_not_clicked():
    hidden = _button(visible=False)
    page = _page({sel: hidden for sel in linkedin_fetcher._EXPAND_SELECTORS})

    asyncio.run(_expand_description(page))

    hidden.evaluate.assert_not_called()


def test_visible_button_gets_a_dom_click_never_a_mouse_click():
    first, second = linkedin_fetcher._EXPAND_SELECTORS[:2]
    btn = _button(visible=True)
    other = _button(visible=True)
    page = _page({first: btn, second: other})

    asyncio.run(_expand_description(page))

    btn.evaluate.assert_awaited_once_with("b => b.click()")
    btn.click.assert_not_called()
    btn.scroll_into_view_if_needed.assert_not_called()
    other.evaluate.assert_not_called()


def test_a_failed_click_moves_on_to_the_next_selector():
    first, second = linkedin_fetcher._EXPAND_SELECTORS[:2]
    broken = _button(visible=True, click_error=RuntimeError("detached"))
    good = _button(visible=True)
    page = _page({first: broken, second: good})

    asyncio.run(_expand_description(page))

    good.evaluate.assert_awaited_once_with("b => b.click()")
