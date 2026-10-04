# Petals3D Architecture

Everything you need to work on this codebase, whether or not you have touched 3D
before. No graphics knowledge is assumed. Section 2 defines every 3D term used
in the rest of the document.

| Section                                            | Answers                             |
| -------------------------------------------------- | ----------------------------------- |
| [1. What it is](#1-what-it-is)                     | what the product does               |
| [2. Vocabulary](#2-vocabulary)                     | what the 3D words mean              |
| [3. Repo tour](#3-repo-tour)                       | where everything lives              |
| [4. The core idea](#4-the-core-idea)               | how a 2D pointer draws in 3D        |
| [5. How a stroke is made](#5-how-a-stroke-is-made) | the geometry pipeline               |
| [6. State](#6-state)                               | who owns what, and the one big cost |
| [7. Saving](#7-saving)                             | the storage shape and its rules     |
| [8. Undo and redo](#8-undo-and-redo)               | how the loop works                  |
| [9. The joystick](#9-the-joystick)                 | the transform widget                |
| [10. Rendering](#10-rendering)                     | cameras, lights, colour             |
| [11. Cookbook](#11-cookbook)                       | "I want to change X, go to Y"       |
| [12. Rough edges](#12-rough-edges)                 | what is broken or unfinished        |

---

## 1. What it is

A **browser-based 3D drawing tool**. You draw freehand strokes with a mouse,
stylus or finger. Each stroke becomes real 3D geometry in a scene you can orbit,
transform, group and export. No account, no install, no server. Work is saved in
the browser.

**The hard problem:** a pointer gives you two numbers, X and Y. A 3D drawing
needs three. Section 4 is how this app answers that, and it is the idea the
whole codebase is built around.

### Getting it running

```bash
npm install     # also installs the pre-commit hook
npm run dev     # http://localhost:3000
npm run build   # type-check, then bundle
npm run lint
npm run format
```

### The stack

| Layer            | Choice                      | Version           |
| ---------------- | --------------------------- | ----------------- |
| Language         | TypeScript, strict          | 6.x               |
| Build            | Vite (Rolldown, oxc minify) | 8.3               |
| UI               | React                       | 19.2              |
| 3D renderer      | three.js                    | 0.186.0           |
| React to three   | @react-three/fiber          | 9.7               |
| Camera, controls | @react-three/drei           | 10.7              |
| Bloom            | @react-three/postprocessing | 3.1               |
| State            | zustand                     | 5.x               |
| Storage          | idb-keyval (IndexedDB)      | 6.x               |
| Styling          | Tailwind CSS                | 4.3 (Vite plugin) |
| Icons            | @tabler/icons-react         | 3.46              |
| Toasts           | react-toastify              | 11.x              |

**Three version pins you cannot casually bump:**

| Pin                   | Why                                                 |
| --------------------- | --------------------------------------------------- |
| React `~19.2.8`       | `@react-three/fiber` requires `>=19 <19.3`          |
| three.js `< 0.187`    | `postprocessing` requires `>=0.168 <0.187`          |
| `build.minify: 'oxc'` | Vite 8 ships Rolldown and no longer bundles esbuild |

Roughly 15,000 lines in `src/`, plus 18 hand-drawn SVG icons.

---

## 2. Vocabulary

Every 3D term this document uses, in plain language.

| Term                | What it means here                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Scene graph**     | A tree of objects three.js draws. `scene.children` is the top level, and almost everything sits there.          |
| **Mesh**            | One drawable thing. A mesh is a geometry plus a material.                                                       |
| **Geometry**        | The raw numbers: vertex positions, normals, colours. No appearance of its own.                                  |
| **Material**        | How a surface reacts to light. Flat, shaded or glowing in this app.                                             |
| **Vertex**          | One corner point of a geometry.                                                                                 |
| **Normal**          | The direction a surface faces at a point. Lighting needs it, and so does drawing onto a surface.                |
| **Raycast**         | Shoot a ray from the pointer into the scene and report what it hits and where.                                  |
| **Quaternion**      | A rotation stored as four numbers. Used instead of three angles because it does not jam at the poles.           |
| **World transform** | Where an object is relative to the scene root.                                                                  |
| **Local transform** | Where an object is relative to its parent. The same as the world transform when the parent is the scene itself. |
| **Extrude**         | Push a flat shape along a direction to give it depth. A line becomes a wall.                                    |
| **Loft**            | Stretch a surface across several curves, like fabric over ribs.                                                 |
| **Sweep**           | Slide a shape along a path to trace out a surface.                                                              |
| **`userData`**      | A free-form object three.js lets you hang on any mesh. **Here it _is_ the saved record.** See section 7.        |
| **Gizmo**           | The arrows and rings you drag to move or rotate a selection.                                                    |
| **DPR**             | Device pixel ratio, real pixels per CSS pixel. Capped at 2 so retina screens stay fast.                         |

---

## 3. Repo tour

```
src/
│
├── main.tsx                    entry point
├── App.tsx                     toast container + Editor
├── App.css                     colour tokens, resets, toast overrides
│
├── components/
│   ├── canvas-operations/      EVERYTHING THAT TOUCHES THE 3D SCENE
│   │   ├── Editor.tsx                page chrome, load, export, shortcuts
│   │   ├── Canvas3d.tsx              <Canvas>, cameras, lights, grids
│   │   ├── CanvasOperations.tsx      mounts every interaction layer
│   │   ├── DrawLine.tsx              the stroke engine
│   │   ├── EraseLine.tsx             raycast eraser
│   │   ├── TransformLine.tsx         select strokes, move, copy, recolour
│   │   ├── TransformGuide.tsx        select and move a guide surface
│   │   ├── DynamicGuidePlane.tsx     draw a guide surface
│   │   ├── DynamicBendGuidePlane.tsx sweep one along a rail
│   │   ├── LoftGuidePlane.tsx        skin one across strokes
│   │   ├── HistoryBridge.tsx         applies undo and redo
│   │   └── JoystickCameraBridge.tsx  tells the joystick where the axes point
│   │
│   ├── joystick/               on-screen transform widget, plain SVG
│   ├── tools/                  the two side rails and their panels
│   ├── groups/                 four modals: add, rename, copy, delete
│   ├── svg-icons/              18 domain icons Tabler has no match for
│   └── *.tsx                   ToolTip, RangeSlider, Toggle, ColorPicker
│
├── hooks/                      nine zustand stores, see section 6
├── helpers/                    geometry maths, history capture, notifications
├── db/storage.ts               every read and write to IndexedDB
├── config/                     scene palette, scene object types
└── types/                      domain.ts (the data model), history.ts
```

### The one rule about this layout

```
                                  may touch the three.js scene?

  components/canvas-operations/   YES. This is the only place.
  components/joystick/            no, it moves a proxy object (section 9)
  components/tools/               no
  components/groups/              no
  hooks/                          no, they hold plain data
  helpers/                        only when a caller hands them the scene
```

Anything outside `canvas-operations/` that needs the scene asks through a store
and lets a component inside the canvas do the work.

### Component tree

```
main.tsx
└── App.tsx
    └── Editor.tsx ................... chrome, load, GLTF export, Ctrl+Z
        ├── ToolPanel.tsx ............ left rail, mode selection
        │   ├── PenOptionsPanel.tsx ....... brush settings
        │   └── SceneOptionsPanel.tsx ..... groups + render settings
        ├── ViewsPanel.tsx ........... right rail, camera, grids, undo, redo
        ├── Joystick.tsx ............. transform widget
        ├── groups/*.tsx ............. four modals
        └── Canvas3d.tsx ............. <Canvas>, cameras, lights, grids
            └── CanvasOperations.tsx . wires the interaction layers
                ├── DrawLine.tsx
                ├── EraseLine.tsx
                ├── TransformLine.tsx        (when Select Lines is on)
                ├── TransformGuide.tsx       (when Select Guide is on)
                ├── DynamicGuidePlane.tsx
                ├── DynamicBendGuidePlane.tsx
                ├── LoftGuidePlane.tsx
                ├── HistoryBridge.tsx
                └── JoystickCameraBridge.tsx
```

### Boot sequence

```
1. useThemeStore reads localStorage, sets .dark on <html>   (before first paint)
2. Editor shows the "pick a pointer type" toast
3. Editor calls loadSceneFromIndexedDB()
4. no saved scene?  create "Group 1"
5. Canvas3d mounts the <Canvas>
6. CanvasOperations calls generateScene()
        rebuilds one mesh per stored stroke, replaying the whole
        pipeline from section 5
7. CanvasOperations calls saveWholeScene()
        rewrites disk, because step 6 dropped the erased records
```

---

## 4. The core idea

A pointer gives you X and Y. The trick is to **draw a surface first, then draw
on it.** Everything else follows from this.

```
 STEP 1  draw a profile           STEP 2  it becomes a wall      STEP 3  draw on it
 on an invisible plane            extruded along the normal      strokes land in 3D
 that always faces you

 ┌────────────────┐               ┌────────────────┐             ┌────────────────┐
 │                │               │      ####      │             │      ##o#      │
 │      ___       │               │    ##/  \##    │             │    ##/ o\##    │
 │    _/   \_     │   ────────▶   │   #/      \#   │  ────────▶  │   #/  o   \#   │
 │   /       \    │               │   /        \   │             │   /  o     \   │
 │                │               │  a curved      │             │  o = samples   │
 └────────────────┘               │  surface       │             │  on the wall   │
   your drag                      └────────────────┘             └────────────────┘
```

**Stage 1.** `DynamicGuidePlane.tsx` holds an invisible 4000x4000 plane at the
origin and copies the camera's rotation onto it every frame, so it is always
square to the viewer. It behaves like a sheet of paper taped to your screen.
Your drag is raycast onto it, giving a flat curve in 3D.

**Stage 2.** On pointer up, that curve is extruded 100 units along the plane's
normal. A flat squiggle becomes a curved wall, tagged
`userData.type = 'OG_GUIDE_PLANE'`.

**Stage 3.** `CanvasOperations` stores the wall as `dynamicDrawingPlaneMesh` and
switches the pen on. `DrawLine.tsx` now raycasts against **the wall** instead of
the flat plane. Every stroke lands on a curved surface, and because the wall
carries real normals, each stroke is oriented correctly in three dimensions.

Repeat to build up a model.

### Three ways to make a guide surface

| Mode           | Component                   | What it does                                | `userData.type`    |
| -------------- | --------------------------- | ------------------------------------------- | ------------------ |
| **Draw guide** | `DynamicGuidePlane.tsx`     | Extrudes a drawn profile into a wall        | `OG_GUIDE_PLANE`   |
| **Bend guide** | `DynamicBendGuidePlane.tsx` | Sweeps the stored profile along a new curve | `BEND_GUIDE_PLANE` |
| **Loft guide** | `LoftGuidePlane.tsx`        | Skins a surface across selected strokes     | `LOFT_SURFACE`     |

**Bend** keeps the first profile you drew in the store as `ogGuidePoints`. You
then draw a second curve, the rail, and `bendOGGuide` slides the profile along
it. That is how organic, curved surfaces get built with no numeric input.

**Loft** works from strokes you already drew. `helpers/loftGuideHelper.ts` flips
them so they all run the same way, joins any that form a closed loop, resamples
them to a matching point count, then stretches a surface across them. Its three
sliders live in `ToolPanel`.

### What the scene can contain

Every object carries a `userData.type`. `types/domain.ts` narrows a raycast hit
with `isLineMesh()` and `isGuideMesh()`.

| Type                 | Meaning                          | Erasable | Guide | Saved |
| -------------------- | -------------------------------- | -------- | ----- | ----- |
| `LINE`               | a completed stroke               | yes      |       | yes   |
| `MERGED_LINE`        | several strokes merged into one  | yes      |       | no    |
| `OG_GUIDE_PLANE`     | extruded guide surface           |          | yes   | no    |
| `BEND_GUIDE_PLANE`   | swept guide surface              |          | yes   | no    |
| `LOFT_SURFACE`       | lofted surface                   |          | yes   | no    |
| `DYNAMIC_GUIDE_LINE` | in-progress guide stroke preview |          | yes   | no    |

Guides are scaffolding. `ClearRemovedObjects` throws them all away at once, and
none of them are ever written to disk.

---

## 5. How a stroke is made

A stroke is **not** a line primitive. It is a solid tube built from scratch,
which is what gives it thickness, shading and something to export.

```
 pointer moves
      │
      ▼
 ┌──────────┐  raycast onto the active guide surface
 │  SAMPLE  │  gives a world point, a surface normal and a pressure value
 └────┬─────┘
      ▼
 ┌──────────┐  moving average, window set by the Stable Stroke slider
 │  SMOOTH  │  removes hand jitter
 └────┬─────┘
      ▼
 ┌──────────┐  drop samples closer together than a tolerance
 │   THIN   │  a slow hand no longer makes thousands of vertices
 └────┬─────┘
      ▼
 ┌──────────┐  parallel transport: rotate each frame from the previous one
 │  FRAME   │  stops the tube twisting as the curve bends
 └────┬─────┘
      ▼
 ┌──────────┐  four corners per point, sized by brush type and pressure
 │ EXTRUDE  │  built as FOUR SEPARATE strips, see below
 └────┬─────┘
      ▼
 ┌──────────┐  merge the strips, compute normals and bounds
 │  MERGE   │  one mesh, tagged LINE
 └────┬─────┘
      ▼
 record pushed into the group, written to IndexedDB, history entry pushed
```

**Why four separate strips.** Generating all four faces of the tube in one
geometry leaves harsh seams along the shared edges, and they become obvious the
moment opacity drops below 1. They are built apart and merged at the end.

### The four brushes

Set by `getAdaptiveStrokeWidth` in `helpers/drawHelper.ts`.

| Brush   | Cross-section                   | Result                             |
| ------- | ------------------------------- | ---------------------------------- |
| `cube`  | square, grows with pen pressure | the default solid stroke           |
| `taper` | square, scaled by `sin(t * pi)` | thin at both ends, thick in middle |
| `paint` | wide, height fixed at 0.01      | a flat brush ribbon                |
| `belt`  | width fixed at 0.01, tall       | a vertical strap                   |

### Three variations on the same pipeline

**Mirroring.** With mirror X, Y or Z on, every sample is moved into the guide
plane's local space, negated on that axis, and moved back. Mirrored strokes are
built alongside the original and saved as independent records with
`is_mirror: true`. All of them undo as one action.

**Tension.** Hold still for one second mid-stroke to enter tension mode. Moving
up and down then pulls every interior point toward the straight line between the
two endpoints, so a wobbly curve can be straightened by feel instead of redrawn.
The pre-tension points are kept, so the effect is continuous, not destructive.

**Primitive shapes.** `straight` snaps the drag to angle increments in the
plane. `circle` and `arc` compute their points from a centre, a normal and the
drag radius. All three then go through the same extrude and merge steps.

---

## 6. State

Nine stores. None use zustand's persist middleware; saving is manual and
explicit.

| Store                     | Owns                                                                  |
| ------------------------- | --------------------------------------------------------------------- |
| `useCanvasDrawStore`      | what the pen is doing: tool flags, brush settings, mirrors, selection |
| `useRenderSceneStore`     | what the scene contains: `groupData`, `activeGroup`, lighting         |
| `useCanvasViewStore`      | camera and viewport: orbit lock, FOV, grids, fullscreen               |
| `useDashboardStore`       | which group modal is open                                             |
| `useHistoryStore`         | the undo and redo stacks, the busy lock                               |
| `useThemeStore`           | light, dark or system. Persisted to localStorage                      |
| `useEditorPrefsStore`     | transform style and step size. Persisted to localStorage              |
| `useTransformTargetStore` | the seam between the canvas and the joystick                          |
| `useJoystickCameraStore`  | where each world axis points on screen. **Not zustand**               |

`useJoystickCameraStore` is a plain module with a listener set, not a
zustand store. The camera publishes whenever it moves, and the joystick
writes the resulting SVG attributes straight to the DOM.

---

## 7. Saving

### The shape on disk

IndexedDB database `petals-3d`, object store `states`.

```
  scene-meta                        one small index, rewritten on any change
  ┌──────────────────────────────┐
  │ groups: [                    │
  │   { uuid, name,              │
  │     visible, active,         │
  │     created_at, deleted_at,  │
  │     lineIds: [ a, b, c ] }   │
  │ ]                            │
  └──────────────────────────────┘
         │  references
         ▼
  line:a ─── LineRecord           one key per stroke,
  line:b ─── LineRecord           written only when that stroke changes
  line:c ─── LineRecord
```

Adding a stroke writes **one** record plus the small index. An older format kept
the whole document under the integer key `0`; the loader still reads it once,
converts it and drops it.

### What a stroke stores

| Field                                         | Purpose                               |
| --------------------------------------------- | ------------------------------------- |
| `type`                                        | `LINE` or `MERGED_LINE`               |
| `points`, `normals`, `pressures`              | the raw samples, the source of truth  |
| `loft_points`                                 | a copy of `points` for the loft tool  |
| `color`, `width`, `opacity`, `stroke_type`    | appearance, replayed on load          |
| `optimization_threshold`, `smooth_percentage` | the exact smoothing used at draw time |
| `position`, `rotation`, `scale`               | world transform                       |
| `is_mirror`, `mirror_mode`                    | mirror provenance                     |
| `uuid`, `group_id`                            | identity and ownership                |
| `is_deleted`                                  | soft delete                           |

### Why the geometry is not stored

Only the **input samples** are saved, never the generated vertex buffers. On
load, `buildLineMesh` replays the whole of section 5 for every stroke.

```
  what is saved              what is thrown away
  ─────────────              ───────────────────
  points                     vertex positions
  normals                    vertex normals
  pressures                  indices
  brush + smoothing params   the merged mesh
```

That keeps documents tiny and lets strokes be re-rendered at other qualities
later. It is also why the smoothing parameters live on every stroke: reproducing
a stroke needs the exact values it was drawn with.

One consequence: a `MERGED_LINE` has no samples of its own, so nothing can
rebuild it. That is why merge is not yet saveable.

### Three rules that will bite you

**1. A mesh's `userData` IS the saved record.**

```
      group.objects[3]  ──┐
                          ├──▶  the same JavaScript object
      mesh.userData     ──┘
```

Mutating one mutates the other. The eraser relies on it: it writes
`mesh.userData.is_deleted = true` and trusts the store to see it. It also means
nothing may keep a record it did not clone, which is why every deliberate copy
goes through `helpers/records.ts`.

**2. IndexedDB throws away prototypes.** Structured clone keeps an object's own
fields and drops its class, so a `THREE.Vector3` would return as a bare
`{x, y, z}` with no methods, and the first method call on it would throw. Points
therefore cross as flat `Float32Array`s and are rebuilt on the way out. The
`Stored*` types in `types/domain.ts` mark which side of the boundary a value is
on. Mixing them silently flattens reloaded strokes.

**3. There is no cross-key transaction.** Writes go lines first, index second,
so a crash in between leaves unreferenced records rather than an index pointing
at nothing. `pruneOrphanLines` sweeps those on the next load.

### When saving happens

On finished actions only: stroke completed, stroke erased, transform applied,
selection recoloured or duplicated, group created, renamed, copied or deleted,
group visibility or active group changed.

There is **no autosave timer, no `beforeunload` and no `visibilitychange`
flush.** A closed tab loses whatever came after the last finished action.

---

## 8. Undo and redo

One user action is one entry, however many objects it touched. A mirrored stroke
that produced four lines is one undo. An eraser drag across nine strokes is one
undo. The limit is 25 entries, and the stacks reset on reload.

An entry is a **pair of patches**, not a document snapshot. It stores what the
action replaced and what it produced, so the cost is proportional to what changed
rather than to the size of the drawing.

```
  [Undo]  or  Ctrl+Z
     │
     │  request('undo')           busy = true, whole editor blocked
     ▼
  useHistoryStore                 past ──▶ future
     │
     │  pending = 'undo'
     ▼
  HistoryBridge  (lives INSIDE the <Canvas>)
     │
     │  1. releaseSelection()     unparent the selection first
     │  2. apply each patch       in reverse order for undo
     │  3. restore the tool       so you land in the tool you acted in
     │  4. finish()               busy = false
     ▼
  scene + IndexedDB + stores all agree again
```

The buttons are ordinary DOM and cannot reach the scene graph, so they **ask**
for an undo rather than performing one. While an entry is applying, every tool
refuses to act and `Editor.tsx` covers the app with a full-screen blocker, since
an entry touches the scene, the document and the stacks in turn, and a click
landing between those steps would see a half-applied editor.

| File                     | Role                                           |
| ------------------------ | ---------------------------------------------- |
| `types/history.ts`       | the patch kinds and `HistoryEntry`             |
| `hooks/useHistoryStore`  | the stacks, the busy lock, the pending request |
| `helpers/historyCapture` | snapshot and restore, `pushHistory`            |
| `helpers/records`        | every deliberate copy of a record or a group   |
| `HistoryBridge.tsx`      | applies patches inside the canvas              |

**Not undoable, on purpose:** camera and viewport state, and brush settings.
Both affect the next action rather than the drawing, and the stroke that used a
brush setting carries its own copy of it.

**Guides are a special case.** Moving a guide surface is undoable, and it is the
only patch kind that touches nothing but the scene: a guide has no record, no
group and no key on disk, so the patch carries the meshes themselves. That works
only because the stacks reset on reload, so the reference is always still the
object on screen. Creating or erasing a guide stays outside history.

`findings/undo-redo-cases.md` lists every case and edge case in detail.

---

## 9. The joystick

The on-screen widget that moves, rotates and scales a selection.

It is **flat SVG outside the canvas**, not a second 3D scene. It still turns
with the camera:

```
  inside the <Canvas>                      outside it
  ───────────────────                      ──────────

  JoystickCameraBridge                     Joystick.tsx
    reads camera.quaternion                  reads those angles
    works out where X, Y, Z                  rotates each handle
    point on screen             ──────▶      to match
    publishes on change                      writes straight to the DOM
```

Only the camera's **orientation** is used, never its lens, so perspective and
orthographic behave identically and no pixel-to-world conversion is needed.
Dragging is quantised into whole steps instead.

### How it reaches the scene without touching it

```
  TransformLine / TransformGuide            Joystick
  ──────────────────────────────            ────────
  collect the selection into                moves that group
  one proxy Group                ──────▶    calls commit()
  publish it through
  useTransformTargetStore
```

That indirection is why the joystick could be added without changing any
selection logic, why the old three.js gizmo still works through the same path,
and why guide surfaces get the same widget for free.

What `commit()` does differs. `TransformLine` bakes the group's world matrix
back into each stroke record and saves them. `TransformGuide` has no records to
save, so it only records history.

### Tuning the feel

| Constant              | File                   | Controls                      |
| --------------------- | ---------------------- | ----------------------------- |
| `PIXELS_PER_STEP`     | `Joystick.tsx`         | move and scale drag rate      |
| `HUB_PIXELS_PER_STEP` | `Joystick.tsx`         | trackball rotation rate       |
| `DEGREES_PER_STEP`    | `Joystick.tsx`         | arc rotation rate             |
| `SCALE_PER_STEP`      | `joystickTransform.ts` | percent per step when scaling |

Leave `DEGREES_PER_STEP` at 1. The arc handle rotates under your finger by the
angle you sweep, and the axis turns by that same angle. Change one without the
other and the handle ends up pointing somewhere the selection is not.

---

## 10. Rendering

| Piece                  | Setup                                                                             |
| ---------------------- | --------------------------------------------------------------------------------- |
| **Cameras**            | Perspective with adjustable FOV, or orthographic. Orbit distance 20 to 150.       |
| **Lighting**           | One directional light with a 1024² shadow map, plus ambient from the theme.       |
| **Light slider**       | Drives only the directional light. High ambient keeps the scene readable at zero. |
| **Bloom**              | Optional. Defers mounting until after the first frame, composites layer 1.        |
| **DPR**                | Capped at `[1, 2]`.                                                               |
| **Sequential loading** | Optional reveal animation, un-hiding one object every 100 ms.                     |

### Colour lives in exactly two places

```
  src/App.css          CSS variables   ──▶  tailwind.config.js  ──▶  bg-surface
                                                                     text-ink
                                                                     bg-accent

  src/config/theme.ts  real hex values ──▶  three.js scene
                                            (cannot read CSS variables)
```

Components never write a hex value and never need a `dark:` variant. The `.dark`
class on `<html>` flips the whole palette at once.

Green is the accent and is reserved for controls that are switched on. Panels,
borders, tracks and text are neutral in both themes.

### Two class names that carry no styles

`custom-scrollbar` and `gesture-allowed` exist only as markers. `Editor.tsx`
finds them with `closest()` to exempt those containers from the page-wide
gesture and scroll suppression. Do not remove them from markup.

---

## 11. Cookbook

| I want to                      | Start here                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------- |
| Add a brush profile            | `getAdaptiveStrokeWidth` in `helpers/drawHelper.ts`                               |
| Add a tool to the left rail    | a new case in `ToolPanel.handleDraw`, plus a button                               |
| Change what a stroke stores    | `LineRecord` in `types/domain.ts`, then `db/storage.ts`                           |
| Make an action undoable        | push a patch via `helpers/historyCapture`, apply it in `HistoryBridge`            |
| Change a UI colour             | the tokens at the top of `src/App.css`                                            |
| Change a 3D scene colour       | `src/config/theme.ts`                                                             |
| Change joystick speed          | the table in section 9                                                            |
| Add a new guide surface type   | a component in `canvas-operations/`, a `userData.type`, `config/objectsConfig.ts` |
| Change when or what gets saved | `db/storage.ts`, and the call sites listed in section 7                           |
| Add a keyboard shortcut        | the `keydown` effect in `Editor.tsx`                                              |
| Understand a raycast hit       | `isLineMesh` and `isGuideMesh` in `types/domain.ts`                               |

### Tool inventory

**Modes**, each clearing the others: `pen`, `eraser`, `selectLines`,
`selectGuide`, `draw_guide`, `erase_guide`, `bend_guide`, `loft_guide`,
`cancel_loft_guide`, `generate_loft_guide`.

**Brush settings:** colour picker with hex field and eyedropper, brush profile,
shape, material, opacity, width, stable stroke, and independent X, Y, Z mirrors.

**View controls:** full screen, perfect view, FOV, three grid planes, orbit
lock, undo, redo.

**Scene options:** group list with visibility and active selection, four group
operations, and the render settings.

**Pointer-type awareness** is unusual and worth knowing about. The app locks on
to the first input device that touches it, and every handler checks
`event.pointerType` against it, so a palm resting on a tablet cannot draw while
a stylus is in use. Override it from the burger menu.

**Export** is ASCII GLTF from the burger menu. Guide surfaces are included
because they share the scene, which is arguably wrong.

---

## 12. Rough edges

An honest list. Nothing here is a surprise waiting to be discovered.

| Issue                                        | Detail                                                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Merge does not persist**                   | A merged mesh has no samples, so nothing can rebuild it. Needs a storage format change. Nothing in the UI triggers it today. |
| **Non-uniform scale on a rotated selection** | Transforms are stored as position, rotation and scale, and a sheared matrix cannot be decomposed into those three.           |
| **Unused vertex colours**                    | Four floats per vertex that no stroke material reads. Enable `vertexColors` or drop the attribute.                           |
| **The ribbon builder is duplicated**         | Roughly 150 lines, four near-identical copies, already drifting.                                                             |
| **No error boundary**                        | Any throw blanks the editor.                                                                                                 |
| **No crash-safe save**                       | Section 7.                                                                                                                   |
| **No tests, no CI**                          | A `lint-staged` pre-commit hook in `.githooks` is the whole safety net.                                                      |
| **One 1.5 MB JS chunk**                      | Past Vite's warning threshold. No code splitting.                                                                            |
