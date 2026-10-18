# Site checks

Browser checks for julianjakob.at. They open the site in real browser engines (WebKit,
which is Safari's engine, and Chromium) on phone and desktop sizes, on a fast connection
and on simulated slow ones. Then they check that nothing a visitor would notice is broken.

The folder name starts with `_`, so GitHub Pages never publishes it.

## Set up (once)

```sh
cd _tests
npm install
npx playwright install webkit chromium
```

## Run

From the site folder, build the pages first, then run the checks:

```sh
node build-pages.js
cd _tests
npm test            # everything, about 15 minutes
npm run quick       # a shorter pass, about 7 minutes
npm test -- names   # only some checks, by name (see below)
```

Each line shows ✓ or ✗. A ✗ line says what was found. The last line sums it up.

## The checks

| Name | What it makes sure of |
| --- | --- |
| `pages` | Every page opens straight from its link, an unknown link goes home, and no text is invisible, half-animated or scrolls sideways. |
| `intro` | On a slow connection the intro cycles through several lines and never shows code. |
| `introLines` | Every intro line fits in two rows on common phones. The 320 px iPhone SE is only reported. |
| `names` | With Details open, project names stay on one line (phone, small phone, desktop, German). |
| `accordions` | Process steps and awards open one at a time, show the right sign and settle after rapid clicks. Copy says "Copied". |
| `fades` | The white scroll fades sit exactly at the screen's top and bottom edges, also while a page folds. |
| `media` | Each device loads the right video and photo cut. The first frame shows behind every video, also on a very slow connection. |
| `print` | The CV prints on exactly one A4 page in English and German. |
| `chaos` | Random sequences of swipes, menu, language, Details, back/forward and rotation. Afterwards nothing is stuck, out of sync or invisible. |

## Test on your phone

`npm run serve` serves the site at `http://<your Mac's address>:8767`. Find the address with
`ipconfig getifaddr en0`, and keep the phone on the same Wi-Fi as the Mac.
