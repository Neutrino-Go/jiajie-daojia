# Changelog

This file records meaningful product, engineering, QA, and release changes for the 家洁到家 mini program.

## Unreleased

### Added

- Added role-aware message tab with `pages/messages/index` and `pages/chat/index`.
- Added MVP text chat backed by `conversations` and `messages` cloud collections.
- Added cleaner income dashboard at `pages/income-stats/index`.
- Added review list page and address management page.
- Added reusable UI components: `stat-card`, `aunt-card`, `message-card`, `status-switch`, and `section-card`.
- Added `docs/BUTTON_FUNCTION_MAP.md` for button and entry regression checks.
- Created AI team operating system documents under `ai-team/`.
- Added task template for future Codex engineering tickets.
- Created dedicated `家洁到家` project folder for the mini program source.
- Added stable image resources for home hero, empty orders, empty favorites, and cleaner guidance states.
- Added `updateOrderPublishMode` cloud action so customers can republish declined assigned orders as public or reassign a saved cleaner.

### Changed

- Changed role selection startup so the identity cards render immediately and cloud login timeout only shows a toast.
- Updated `app.js` to read the first configured CloudBase env from `miniprogram/envList.js` when present.
- Rewrote README cloud setup instructions with explicit `envList.js` guidance.
- Changed order list tabs from horizontal scrolling pills to a two-column wrapping grid to avoid half-visible buttons on narrow devices.
- Changed customer home stats from a fragile four-column row to a stable two-by-two grid.
- Changed address selection community input from fixed choices to manual entry.
- Changed street options to update from the selected city/district, with local MVP mappings and a default fallback.
- Changed cleaner service areas from fixed choices to manual multi-tag entry.
- Changed message timestamps to use a space between date and time instead of the ISO `T` separator.
- Rebuilt bottom Tab structure to `首页/订单/消息/我的` for customers and `接单/订单/消息/我的` for cleaners.
- Rebuilt `pages/home/index` as a role-aware customer home / cleaner order-grab page.
- Rebuilt publish, order list, order detail, and profile pages around the product prototype structure.
- Replaced crowded button rows with wrapped cards, segmented controls, bottom actions, or single-purpose buttons.
- Changed cleaner list from a tab page into a customer-only normal page.
- Established Definition of Done and Release Checklist as project operating rules.
- Moved all 家洁到家 mini program files into `D:\WeChat MiNi App\家洁到家`.
- Updated WeChat project name from quickstart to `家洁到家`.
- Replaced the quickstart README with project-specific setup notes.
- Tightened role isolation across tab pages using role-specific rendering instead of cleaner-tab redirect flicker.
- Updated cleaner profile handling to upsert a default unapproved/unavailable profile when a cleaner role is selected or edited.
- Changed profile common address entry to open the in-app address selector instead of map location.
- Added cloud-side order detail access checks for customers, assigned/accepted cleaners, and approved cleaners viewing public pending orders.

### Fixed

- Fixed `components/stat-card/index.wxss` orphan declarations that caused WXSS compilation to fail and white-screen the mini program.
- Fixed profile shortcut buttons overflowing/misaligned on the right edge.
- Fixed profile menu rows visually collapsing toward the center by tightening full-width row layout.
- Fixed order detail contact buttons being too wide and inconsistent.
- Fixed button/content overflow caused by the global mini-program button default behavior.
- Fixed a remaining invalid `switchTab` path from saved cleaners to the non-tab cleaner list.
- Fixed customer/cleaner action leakage in key order and profile flows.
- Fixed missing customer message entry and cleaner income entry.
- Fixed missing image files referenced by WXML.
- Fixed the new-cleaner dead end where `updateCleanerProfile` required a pre-existing cleaner document.
- Fixed declined assigned orders becoming hidden from both public and assigned lists with no customer recovery path.
- Fixed misleading cleaner verification copy for unapproved/unavailable cleaner profiles.

### Verification

- WXSS orphan property scan passed for all `.wxss` files.
- `node --check` passed for all JavaScript files.
- JSON parse check passed for all JSON files.
- `npm.cmd test` passed in `cloudfunctions/quickstartFunctions`.
- Documentation files created and reviewed for structure.

### Deployment Notes

- No mini program or cloud deployment required for this documentation-only change.
