# The FieldComm Draw spec format

A plan is a short text file in feet. Rooms are rectangles; openings are placed
by the wall they sit in and their distance from that wall's start. The engine
draws only what the numbers say.

```yaml
project: "Demo Cottage - 3 BR / 1 BA"
wall_system: {exterior: "2x6", interior: "2x4"}   # 7¼" exterior, 4½" partitions
rooms:              # x, y = southwest corner; w = east-west, h = north-south
  - {name: "Living / Kitchen", type: living,  x: 0,  y: 0, w: 24, h: 15}
  - {name: "Bedroom 1",        type: bedroom, x: 24, y: 0, w: 14, h: 15}
doors:              # side: N/S/E/W wall of that room; offset from its W or S end
  - {room: "Living / Kitchen", side: S, offset: 10, width: 3}
windows:
  - {room: "Bedroom 1", side: E, offset: 5, width: 4}
dim_chains:         # drawn only if segments add up to overall AND land on walls
  - {p0: [0, 15], segments: [24, 14], overall: 38, orient: H, side: 1, offset: 2.5}
```

**Room types and their minimums** (FBC 2023 Residential / IRC 2021 planning baselines):

| type | min area | min side | notes |
|---|---|---|---|
| `living` | 120 sf | 10 ft | R304.1 |
| `bedroom` | 70 sf | 7 ft | needs an egress window (R310) |
| `habitable` | 70 sf | 7 ft | R304 |
| `kitchen` | 50 sf | 3 ft | |
| `bathroom` | 18 sf | 2.5 ft | |
| `utility` | 12 sf | 2.5 ft | |
| `closet` | 4 sf | 2 ft | |
| `circulation` | — | 3 ft | halls |
| `garage` | 200 sf | 10 ft | |
| `porch` | — | 4 ft | |

**Tiers:** Tier 1 (schematic) reports problems but releases the drawing.
Tier 2 (permit-intent) holds the drawing until every room passes.

The full engine also reads `fixtures` and `title_block`; the browser demo ignores them.

This format and the examples are CC BY 4.0. See [LICENSE](LICENSE).
