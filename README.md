# Cement Plant Digital Twin

A browser digital twin of a cement works, built on the supplied GLB. The 3D model
drives the asset register: hotspots are anchored to geometry measured out of the
file, not to hand-placed coordinates.

Runs on **http://localhost:7373**.

```bash
npm install
npm run dev      # http://localhost:7373
```

---

## Read this first: the source file was an incomplete download

The supplied `Unconfirmed 812475.crdownload` is a **partial Chrome download**:

| | |
|---|---|
| Declared in the GLB header | 174,489,696 bytes |
| Actually on disk | 131,038,028 bytes |
| Binary payload present | **73.7 %** |

The file was not still downloading — the size was stable.

It turned out to matter less than it looks, because the asset holds **four
near-duplicate copies** of the plant as separate glTF scenes, and the truncation
landed in the last one:

| Scene | Meshes intact | |
|---|---|---|
| `Maintances` | 3287 / 3287 | complete |
| **`Process`** | **3293 / 3293** | **complete — the twin uses this one** |
| `Quality` | 3147 / 3227 | 97.5 % |
| `With energy Sources` | 0 / 3266 | lost |

So the twin is built on a **complete, undamaged** copy of the plant. What the
truncation did cost:

- the `With energy Sources` scene variant, and 80 meshes of `Quality`
- both embedded textures (the model is untextured; the viewer applies its own
  PBR surfaces, keyed off the original CAD material names)

**If you re-download the file completely, nothing here needs changing** — rerun
the pipeline below and the extra scene variant becomes available via
`PLANT_SCENE`.

---

## Model pipeline

Two steps, both re-runnable against a complete file.

```bash
# 1. rebuild a valid GLB from whatever actually arrived
python3 tools/salvage_glb.py "Unconfirmed 812475.crdownload" build/plant-salvaged.glb

# 2. extract one scene, measure hotspots, optimise
node tools/prepare-model.mjs build/plant-salvaged.glb \
     public/models/plant.glb src/data/plant-geometry.json

# pick a different scene variant
PLANT_SCENE="Maintances" node tools/prepare-model.mjs ...
```

**`tools/salvage_glb.py`** keeps every buffer view that lies fully inside the
bytes that arrived, then prunes the accessors, primitives, meshes and nodes that
depended on the missing tail, and rewrites a spec-valid GLB. On a complete file
it is close to a no-op.

**`tools/prepare-model.mjs`** does the rest:

1. keeps one scene (the four are variants, not parts)
2. drops spatial outliers — this export carries a `PRESSURE TANK` solid parked
   **1,015,720 units** across, a million units from the site, plus a single
   backdrop plane that encloses the scene
3. measures world-space bounds of the named equipment **before** any merge, while
   per-object identity still exists, and clusters the repeated silos into
   spatially coherent groups on the horizontal plane
4. bakes a 318-point hull cloud used for exact camera framing (fitting the
   bounding *box* wastes most of the frame — the site is laid out diagonally)
5. anonymises the 3,272 bulk CAD solids so they can merge by material, then
   `dedup → flatten → join → weld → prune → meshopt`

Result:

| | before | after |
|---|---|---|
| File | 128.7 MB | **6.4 MB** |
| Meshes | 3,293 | **10** |
| Triangles | — | 1.19 M |

The named equipment stays as separate nodes, so selection can highlight real
geometry while the bulk structure costs almost nothing.

### What the model actually contains

Scanning the node names, the only semantically named equipment is the preheater
tower, the clinker silo and 14 cement silos — the other ~3,075 objects are
unnamed CAD solids (`3D Solid.9999`), terrain rock and ground planes. The valve
and fire-pump names present in the file sit on **empty nodes with no geometry**,
so they are not offered as hotspots.

That gives **7 geometry-anchored assets**. The remaining process stages (crusher,
raw mill, kiln, cooler, cement mill, packing) have no geometry in this GLB, and
the UI labels them *"not in GLB · tag only"* rather than inventing a hotspot.

---

## Telemetry is simulated

There is no plant connection, so `src/sim.js` generates the signals. It is not
noise on a sine wave:

- every tag is a mean-reverting (Ornstein–Uhlenbeck) walk bounded by its own
  swing inside a realistic envelope for a ~1.5 Mtpa dry-process line
- a coupling pass applies relationships an operator would recognise — kiln feed
  drives clinker output, a cold calciner raises free lime and drops litre weight,
  poor cooler recuperation raises specific heat consumption, CO and NOx trade off
- silo levels genuinely **integrate** mill output against dispatch, cell by cell,
  at `SIM_HOURS_PER_TICK` (0.2 h per second — the header states the 720× factor)
- occasional process upsets (reducing conditions, coating build-up, a bag-filter
  compartment offline) make the alarm list earned rather than random

Over a 4,000-tick run: ~30 % of ticks carry at least one alarm, warnings outnumber
criticals 4:1, and no tag drifts out of range.

### Connecting real data

`src/sim.js` is the only module that knows where numbers come from. Replace it
with a feed exposing `state` (a flat `code -> value` map), `history(code)`,
`alarms`, `severity()` and `assetSeverity()`, and the UI is unchanged. Every tag
in `src/data/process.js` already carries the `unsTopic` it would bind to
(`plant1/pyro/ph_calc_t`, …), shown under each tag name in the detail panel.

---

## Using it

The twin runs **3D-only**. The one control is the **Annotations** switch in the
header (or press `A`); camera presets stayed on keys `1`–`4` after their buttons
were removed. Click any area label to fly to it, `Esc` to clear.

### The area annotations

Ten areas from the reference dashboard — LS Crusher, Raw Mill, Ball Mill, Kiln,
Coal Mill, Cement Mill, Slag Mill, Packaging Plant, Utilities – Pump House,
Utilities – Compressor — defined in `src/data/areas.js`.

Built to the Faclon/Bruce demo: a **single-row pill** with a status-coloured
badge, the name, and a colour-coded headline metric. Instrumented areas show live
**OEE**; the rest show month-to-date maintenance cost. Bands are green ≥ 85 %,
amber 60–85 %, red below, and the leader line takes the same colour.

Clicking a pill **expands it in place** — the pill stays as the card's header and
the body grows beneath it, with the chevron flipping, exactly as in the demo
rather than gaining a second coloured bar that restates the name:

- A / P / Q, each **banded separately** — a 94 % quality figure is healthy while a
  94 % availability is not, so one shared threshold would mislead on both
- Output against rate, warning and critical counts, the tag count
- Product and month-to-date maintenance
- **Open Area Dashboard**, through to the full RCA
- The **Bruce Insight** card where BRUCE has a finding: root cause, recommended
  actions each with their own downtime and OEE gain, and the shift value of acting

**The data is real**, not decoration. `src/data/equipment.js` gives each area the
instrumentation an operator would see on its faceplate — 64 tags (mill ΔP,
trunnion bearing temps, kiln shell and burning-zone temperature, tyre slip,
separator speed, lube oil pressure…) plus an Availability / Performance / Quality
profile. The simulator walks them; the pill counts how many are outside limits and
multiplies A × P × Q for OEE. Availability is pulled down by critical alarms, so a
red alarm list and a falling OEE agree rather than drifting apart.

A pure mean-reverting walk never raises an alarm — every tag parks on its setpoint
and the list stays empty forever. A real plant always carries a few nagging tags
sitting on a limit, so a seeded minority get a chronic bias toward their nearest
limit. Those hover in and out of warning, which is what makes the counts move.

**Maintenance cost and the ₹ impact figures have no data feed** — they are the
reference dashboard's numbers, sitting in `areas.js` and `rca.js` as fields to
wire up.

### Where the labels point

Anchors were placed by identifying equipment from the geometry, not by eye. The
blue material (confusingly named `Red`, base colour RGB 17,23,142) carries the
plant's equipment, so the mills, kiln and tanks were found by shape among it:

| Area | Identified as |
|---|---|
| Kiln | the long rotary tube with riding rings, ~10:1, preheater → cooler |
| Ball Mill | the short ringed cylinder, ~2:1, in the back row |
| Raw Mill | mill housing with circular end faces, back row |
| Cement Mill | the large blue drum on the west side |
| Slag Mill | round tank, south-west corner |
| Packaging Plant | the blue-roofed shed |

**Two caveats.** The naming is still inference — the GLB names only the preheater,
the clinker silo and 14 cement silos, so which structure is "Raw Mill" follows the
process order of a dry-process line. And **this model has no distinct pump-house or
compressor geometry**: the right-hand side is the preheater tower, two silos, the
kiln and ducting. Those two labels sit on the nearest right-hand equipment, so
they are the weakest of the ten.

**Markers cannot float.** On load every anchor is raycast straight down onto the
model and snapped to the surface it hits. If an anchor's x/z sits over empty
ground — easy to do, because a diagonal conveyor's *bounding box* covers far more
ground than the conveyor itself — the viewer searches outward for the nearest
geometry, snaps to that, and logs the corrected position to the console.

To re-place one: click anywhere on the model and the clicked world position is
logged as `[x, y, z]`. Paste it in as that area's `anchor`.

Pills sit above their point with a curved leader to a marked dot, so a label never
covers what it names. Collisions resolve in a fixed order (the order areas are
declared) rather than by camera distance — that is what stops them swapping places
as you orbit — and stack upward when they run out of room at the bottom. A pill
clipped by the viewport edge is clamped into view rather than hidden.

### BRUCE

The twin stays a quick overview; every detailed KPI lives here. Collapsed, BRUCE
is a pill in the bottom-right with a red dot that appears only when an area is
genuinely critical. Expanded, it is the right-docked panel:
**Recommendations / Insights**, content, and the ask box.

An area's card hands the question over, so nobody has to compose one:

> **How is the Kiln running?**

comes back as a structured assessment after ~3 s of visible reasoning:

| | |
|---|---|
| **Performance** | Production 138 / 150 T/H — 8.0 % below target · Specific heat consumption 729 kcal/kg clinker — *compare with plant target/benchmark* · OEE 85.7 % |
| **Condition** | Refractory Health 91/100 — healthy · Shell Temperature 327 °C — within band · Hot Spots 0 — none detected |
| **Current Issues** | every tag outside its limits, with its value |
| **Likely Cause** | stated as a hypothesis, with the evidence it would need |
| **Recommended Action** | short, ordered steps |

**Nothing is fabricated.** Each figure is derived from tags the simulator already
walks, by a stated formula; anything without a basis in the model returns null and
is omitted rather than invented:

- **Hot spots** — shell pyrometer zones above their high limit (six are modelled
  along the kiln)
- **Refractory health** — 100, less 7 per hot spot, less a penalty for how far the
  hottest zone sits above nominal
- **Overall health** — 100, less 6 per critical and 2 per warning tag, less the
  shortfall below an 85 % OEE target
- **SEC** — the existing specific-heat tag for the pyro line, specific power
  elsewhere

Where the model holds no benchmark the figure is named as something to compare
against rather than asserted, and where a cause cannot be confirmed it is offered
as a hypothesis with the trends that would support it.

Free-text questions are answered the same way — worst or best performer, alarms, a
named area — so BRUCE can be wrong about your plant, because the telemetry is
simulated, but never about what the page is showing. The mic uses the browser's
SpeechRecognition where it exists and says so plainly where it does not.

The mark lives at `public/bruce-logo.svg` and drives both the launcher and the
panel header; replace that one file to swap it everywhere.

### Legibility on a white scene

A blue-on-white plant is mostly pale surfaces on a pale backdrop, which is the
hardest case to light. Three things make it readable, and all three were measured
off rendered pixels rather than eyeballed:

1. **Linear output, not ACES.** The filmic curve rolls every bright value toward
   the same white — with it on, the floor rendered luma 219 and the sky 220, so
   the model dissolved. `NoToneMapping` means the chosen albedo is the albedo on
   screen.
2. **A deliberate value ladder.** Backdrop → floor → silo → structure → pad, each
   a clear step darker (luma 226 / 215 / 193 / 163 / 130), with the blue at 107.
   The model's "white" surfaces are light *grey*; painted actual white they
   differ from the backdrop by a percent or two and vanish.
3. **Ambient occlusion** (`GTAOPass`). Lighting alone cannot separate one pale
   surface from the pale surface behind it — the contact darkening is what reads
   as form. It falls back to direct rendering if the pass will not build, and
   `__twin.viewer.setAO(false)` turns it off.

Lighting is a product-render set: one dominant key for form, modest fill, soft
contact shadows, and haze that dissolves the floor's edge into the backdrop so
there is no horizon line.

---

## Layout

```
src/
  main.js              boot, loops, wiring
  viewer.js            three.js stage, materials, camera fitting, hotspots
  sim.js               process simulator  ← swap this for live data
  hud.js               slim top bar + canvas controls
  charts.js            `fmt` in use; sparkline/meter/chip kept for the panels' return
  data/process.js      tag definitions, limits, UNS topics, camera presets
  data/plant-geometry.json   generated — hotspot anchors, hull, bounds
tools/
  salvage_glb.py       truncated GLB  → valid GLB
  prepare-model.mjs    valid GLB      → runtime asset + geometry metadata
```

The removed dashboard regions were deleted from the layout, not from the model:
`data/process.js` still defines the process stages and plant KPIs, and the
simulator still computes them, so the panels can be reinstated without rework.

`vite.config.js` pins port 7373 and allows the proxied hostname
`cement-twin.iocompute.ai`; add any other public hostname to `allowedHosts`.
