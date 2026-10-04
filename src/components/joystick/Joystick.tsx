import {
    useEffect,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
    memo,
} from 'react'
import * as THREE from 'three'

import {
    IconArrowsMaximize,
    IconArrowsMove,
    IconConeFilled,
} from '@tabler/icons-react'

import ToolTip from '../ToolTip'
import { canvasDrawStore } from '../../hooks/useCanvasDrawStore'
import { editorPrefsStore } from '../../hooks/useEditorPrefsStore'
import { transformTargetStore } from '../../hooks/useTransformTargetStore'
import { historyBusy } from '../../helpers/historyCapture'
import {
    cameraQuaternion,
    getAxisScreen,
    subscribeAxisScreen,
    type AxisScreenMap,
} from '../../hooks/useJoystickCameraStore'

import {
    ARC_COLOR,
    ARC_PAIRS,
    ARC_RADIUS,
    ARC_STROKE,
    AXES,
    AXIS_COLOR,
    AXIS_LABEL,
    CENTRE,
    CONE_DISTANCE,
    CONE_SIZE,
    CUBE_SIZE,
    HUB_RADIUS,
    RAIL_LENGTH,
    RAIL_MAX_OFFSET,
    RAIL_MIN_OFFSET,
    MIN_DEPTH,
    VIEW,
    pairArcPath,
    rotateAbout,
    type ConeAction,
    type JoystickAxis,
} from './joystickGeometry'
import { CUBE_FACE_KEYS, cubeFaces } from './joystickCube'
import {
    freeRotateByStep,
    moveByStep,
    rotateByStep,
    scaleByStep,
    scaleUniformByStep,
} from './joystickTransform'

/*
 * How much drag it takes to emit one step. Lower is faster, and these are the
 * numbers to change if the widget feels sluggish: a step is one world unit to
 * move and one percent to scale, so the rate is set here rather than by making
 * a step mean more.
 */

/** Pixels of drag per step for the cones and the scale ring. */
const PIXELS_PER_STEP = 6

/** Pixels per step for the trackball, where a step is a degree. */
const HUB_PIXELS_PER_STEP = 0.5

/**
 * Degrees of sweep around the widget per rotation step. One, so an arc turns
 * its axis by exactly the angle the finger swept: the handle rotates with the
 * pointer, and anything else would leave the two pointing different ways.
 */
const DEGREES_PER_STEP = 1

/** Themed, so the handles' cursor is visible on both grounds. */
const GRAB = { cursor: 'var(--cursor-grab)' }

type HandleKey =
    `cone-${JoystickAxis}` | `arc-${JoystickAxis}` | 'hub' | 'uniform'

interface DragState {
    handle: HandleKey
    originX: number
    originY: number
    /** Widget centre in page coordinates, for measuring arc sweep. */
    pivotX: number
    pivotY: number
    startAngle: number
    /** SVG user units per screen pixel, so the rail follows the pointer. */
    unitsPerPixel: number
    /** Steps already applied, so each move only emits the difference. */
    appliedX: number
    appliedY: number
}

const toRadians = (deg: number) => (deg * Math.PI) / 180

/** Scratch, so painting the cube allocates nothing. */
const spareQuaternion = new THREE.Quaternion()

/**
 * Transforms the current selection in whole steps.
 *
 * Flat SVG, not a second 3D scene, but it turns with the camera: the bridge
 * inside the canvas publishes where each world axis points on screen and the
 * handles follow. Only the camera's orientation is used, never its lens, so
 * perspective and orthographic behave alike with no pixel-to-world conversion.
 */
const Joystick = () => {
    const target = transformTargetStore((state) => state.target)
    const transformStep = editorPrefsStore((state) => state.transformStep)
    const axisMode = canvasDrawStore((state) => state.axisMode)

    const [coneAction, setConeAction] = useState<ConeAction>('move')
    const [active, setActive] = useState<HandleKey | null>(null)

    const drag = useRef<DragState | null>(null)
    const axes = useRef<AxisScreenMap>(getAxisScreen())
    const svgRef = useRef<SVGSVGElement>(null)
    const coneRefs = useRef(new Map<string, SVGGElement | null>())
    const slideRefs = useRef(new Map<string, SVGGElement | null>())
    const arcRefs = useRef(new Map<string, SVGPathElement | null>())
    const faceRefs = useRef(new Map<string, SVGPathElement | null>())
    const viewed = useRef(new THREE.Quaternion())

    /**
     * Redraws the cube from the selection's rotation in the camera's frame, so
     * turning the selection towards you turns the cube face towards you.
     * Written straight to the DOM: state would re-render on every orbit frame.
     */
    function paintCube(): void {
        const object = transformTargetStore.getState().target?.object
        if (!object) return

        viewed.current
            .copy(cameraQuaternion)
            .invert()
            .multiply(object.getWorldQuaternion(spareQuaternion))

        for (const face of cubeFaces(
            viewed.current,
            CUBE_SIZE,
            CENTRE,
            CENTRE
        )) {
            const node = faceRefs.current.get(face.key)
            if (!node) continue
            node.setAttribute('d', face.d)
            node.setAttribute('display', face.visible ? 'inline' : 'none')
        }
    }

    // Camera updates go straight to the DOM, for the same reason.
    useEffect(() => {
        const paint = (next: AxisScreenMap) => {
            axes.current = next

            for (const axis of AXES) {
                const node = coneRefs.current.get(axis)
                if (!node) continue
                node.setAttribute('transform', rotateAbout(next[axis].angle))
            }

            for (const pair of ARC_PAIRS) {
                const node = arcRefs.current.get(pair.axis)
                if (!node) continue
                const arc = pairArcPath(
                    next[pair.from].angle,
                    next[pair.to].angle
                )
                node.setAttribute('d', arc.d)
                // A pair whose cones have nearly converged leaves no arc worth
                // grabbing, so it fades out rather than becoming a stub.
                node.setAttribute('opacity', arc.span > 18 ? '1' : '0.25')
            }

            paintCube()
        }

        paint(getAxisScreen())
        return subscribeAxisScreen(paint)
    })

    if (!target) return null

    function applySteps(handle: HandleKey, dx: number, dy: number): void {
        if (!target) return
        const object = target.object

        if (handle === 'hub') {
            freeRotateByStep(object, cameraQuaternion, transformStep, dx, dy)
            paintCube()
            return
        }

        if (handle === 'uniform') {
            scaleUniformByStep(object, transformStep, dx)
            return
        }

        const axis = handle.slice(-1) as JoystickAxis
        if (handle.startsWith('arc')) {
            rotateByStep(object, axis, axisMode, transformStep, dx)
            paintCube()
        } else if (coneAction === 'move') {
            moveByStep(object, axis, axisMode, transformStep, dx)
        } else {
            scaleByStep(object, axis, transformStep, dx)
        }
    }

    /**
     * Pointer position to whole steps. A cone measures along the direction it
     * points on screen; an arc measures sweep around the widget.
     */
    function stepsFor(state: DragState, clientX: number, clientY: number) {
        const dx = clientX - state.originX
        const dy = clientY - state.originY

        if (state.handle === 'hub') {
            return {
                x: Math.trunc(dx / HUB_PIXELS_PER_STEP),
                y: Math.trunc(dy / HUB_PIXELS_PER_STEP),
            }
        }

        if (state.handle === 'uniform') {
            return { x: Math.trunc(dx / PIXELS_PER_STEP), y: 0, sweep: 0 }
        }

        const axis = state.handle.slice(-1) as JoystickAxis
        const screen = axes.current[axis]

        if (state.handle.startsWith('arc')) {
            const now =
                (Math.atan2(clientY - state.pivotY, clientX - state.pivotX) *
                    180) /
                Math.PI

            // Unwrap across the -180/180 seam so a sweep past it is continuous.
            let swept = now - state.startAngle
            if (swept > 180) swept -= 360
            if (swept < -180) swept += 360

            return {
                x: Math.trunc((swept * screen.facing) / DEGREES_PER_STEP),
                y: 0,
                sweep: swept,
            }
        }

        const radians = toRadians(screen.angle)
        const along = dx * Math.cos(radians) + dy * Math.sin(radians)
        return { x: Math.trunc(along / PIXELS_PER_STEP), y: 0, sweep: 0 }
    }

    function onDown(e: ReactPointerEvent<SVGElement>) {
        // The joystick moves the same records an undo is rewriting.
        if (historyBusy()) return

        const handle = e.currentTarget.dataset.handle as HandleKey | undefined
        if (!handle) return

        // An axis pointing almost at the camera has no usable screen direction.
        if (handle.startsWith('cone')) {
            const axis = handle.slice(-1) as JoystickAxis
            if (axes.current[axis].depth < MIN_DEPTH) return
        }

        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)

        const box = svgRef.current?.getBoundingClientRect()
        const pivotX = box ? box.left + box.width / 2 : e.clientX
        const pivotY = box ? box.top + box.height / 2 : e.clientY

        // Lets the transform layer record the starting positions, which it
        // needs before the drag overwrites them.
        target?.beginDrag()

        drag.current = {
            handle,
            originX: e.clientX,
            originY: e.clientY,
            pivotX,
            pivotY,
            startAngle:
                (Math.atan2(e.clientY - pivotY, e.clientX - pivotX) * 180) /
                Math.PI,
            appliedX: 0,
            appliedY: 0,
            unitsPerPixel: box ? VIEW / box.width : 1,
        }
        setActive(handle)
    }

    function onMove(e: ReactPointerEvent<SVGElement>) {
        const state = drag.current
        if (!state) return

        // Measured from where the drag started, not the previous event, so
        // rounding cannot accumulate across a long drag.
        const want = stepsFor(state, e.clientX, e.clientY)

        // The arc spins with the pointer and is put back on release; its
        // resting place is set by the two cones it spans.
        if (state.handle.startsWith('arc')) {
            const node = arcRefs.current.get(
                state.handle.slice(-1) as JoystickAxis
            )
            node?.setAttribute('transform', rotateAbout(want.sweep ?? 0))
        }

        // The cone slides along its rail, clamped to the ends. Measured in the
        // rotated frame, so sideways drag is ignored.
        if (state.handle.startsWith('cone')) {
            const axis = state.handle.slice(-1) as JoystickAxis
            const radians = toRadians(axes.current[axis].angle)
            const along =
                (e.clientX - state.originX) * Math.cos(radians) +
                (e.clientY - state.originY) * Math.sin(radians)

            const offset = Math.max(
                RAIL_MIN_OFFSET,
                Math.min(RAIL_MAX_OFFSET, along * state.unitsPerPixel)
            )
            slideRefs.current
                .get(axis)
                ?.setAttribute('transform', `translate(${offset} 0)`)
        }

        const deltaX = want.x - state.appliedX
        const deltaY = want.y - state.appliedY
        if (deltaX === 0 && deltaY === 0) return

        applySteps(state.handle, deltaX, deltaY)
        state.appliedX = want.x
        state.appliedY = want.y
    }

    function onUp(e: ReactPointerEvent<SVGElement>) {
        const state = drag.current
        if (!state) return
        e.currentTarget.releasePointerCapture(e.pointerId)
        drag.current = null
        setActive(null)

        if (state.handle.startsWith('arc')) {
            arcRefs.current
                .get(state.handle.slice(-1) as JoystickAxis)
                ?.removeAttribute('transform')
        }

        if (state.handle.startsWith('cone')) {
            slideRefs.current
                .get(state.handle.slice(-1) as JoystickAxis)
                ?.removeAttribute('transform')
        }

        // Only write to the records if something actually moved.
        if (state.appliedX !== 0 || state.appliedY !== 0) target?.commit()
    }

    const keepCone = (axis: string) => (node: SVGGElement | null) => {
        coneRefs.current.set(axis, node)
    }

    const keepArc = (axis: string) => (node: SVGPathElement | null) => {
        arcRefs.current.set(axis, node)
    }

    const keepFace = (key: string) => (node: SVGPathElement | null) => {
        faceRefs.current.set(key, node)
    }

    const keepSlide = (axis: string) => (node: SVGGElement | null) => {
        slideRefs.current.set(axis, node)
    }

    const initial = getAxisScreen()
    const coneVerb = coneAction === 'move' ? 'Move' : 'Scale'
    const holdingHub = active === 'hub'

    // While an arc is spun everything else hides, so the handle in play is
    // unobstructed and the cube reads clearly behind it.
    const spinningAxis = active?.startsWith('arc')
        ? (active.slice(-1) as JoystickAxis)
        : null

    return (
        <div className="absolute right-[12px] bottom-[16px] z-5 flex flex-col items-end gap-[8px]">
            <div className="rounded-full border-[1px] border-line/25 bg-surface p-[6px] drop-shadow-xl">
                {/* Labels are native <title> elements: ToolTip renders a div,
                    which is not valid inside an svg. */}
                <svg
                    ref={svgRef}
                    viewBox={`0 0 ${VIEW} ${VIEW}`}
                    overflow="visible"
                    className="size-[132px] touch-none select-none md:size-[156px]"
                    role="group"
                    aria-label="Transform joystick"
                >
                    {/* Rotation arcs, each spanning the gap between two cone
                        tips and turning the axis those two define. */}
                    {ARC_PAIRS.map((pair) => {
                        const arc = pairArcPath(
                            initial[pair.from].angle,
                            initial[pair.to].angle
                        )
                        return (
                            <path
                                key={`arc-${pair.axis}`}
                                ref={keepArc(pair.axis)}
                                d={arc.d}
                                stroke={ARC_COLOR}
                                strokeWidth={ARC_STROKE}
                                strokeLinecap="round"
                                fill="none"
                                display={
                                    spinningAxis && spinningAxis !== pair.axis
                                        ? 'none'
                                        : 'inline'
                                }
                                data-handle={`arc-${pair.axis}`}
                                onPointerDown={onDown}
                                onPointerMove={onMove}
                                onPointerUp={onUp}
                                onPointerCancel={onUp}
                                style={GRAB}
                            >
                                <title>{`Rotate ${AXIS_LABEL[pair.axis]}`}</title>
                            </path>
                        )
                    })}

                    {AXES.map((axis) => (
                        <g
                            key={`cone-${axis}`}
                            ref={keepCone(axis)}
                            transform={rotateAbout(initial[axis].angle)}
                            display={spinningAxis ? 'none' : 'inline'}
                        >
                            {/* The rail, shown only while its cone is held. It
                                sits inside the rotated group, so it lines up
                                with the axis for free. */}
                            {active === `cone-${axis}` && (
                                <line
                                    x1={CENTRE - RAIL_LENGTH}
                                    y1={CENTRE}
                                    x2={CENTRE + RAIL_LENGTH}
                                    y2={CENTRE}
                                    stroke="var(--c-contrast)"
                                    strokeWidth={1.2}
                                    strokeDasharray="2 3"
                                    strokeLinecap="round"
                                    pointerEvents="none"
                                />
                            )}

                            {/* Two groups: this one takes the drag offset, the
                                inner one the resting place. Separate, so the
                                offset clears without disturbing either. */}
                            <g ref={keepSlide(axis)}>
                                {/* The glyph points up, so it is turned 90
                                    degrees to face outward. */}
                                <g
                                    transform={`translate(${CENTRE + CONE_DISTANCE} ${CENTRE}) rotate(90)`}
                                    data-handle={`cone-${axis}`}
                                    onPointerDown={onDown}
                                    onPointerMove={onMove}
                                    onPointerUp={onUp}
                                    onPointerCancel={onUp}
                                    style={GRAB}
                                >
                                    <title>{`${coneVerb} ${AXIS_LABEL[axis]}`}</title>
                                    <IconConeFilled
                                        x={-CONE_SIZE / 2}
                                        y={-CONE_SIZE / 2}
                                        width={CONE_SIZE}
                                        height={CONE_SIZE}
                                        color={AXIS_COLOR[axis]}
                                    />
                                </g>
                            </g>
                        </g>
                    ))}

                    {coneAction === 'scale' && (
                        <circle
                            cx={CENTRE}
                            cy={CENTRE}
                            r={ARC_RADIUS - 12}
                            fill="none"
                            stroke="var(--c-ink-muted)"
                            strokeWidth={active === 'uniform' ? 5 : 3}
                            strokeDasharray="3 5"
                            data-handle="uniform"
                            onPointerDown={onDown}
                            onPointerMove={onMove}
                            onPointerUp={onUp}
                            onPointerCancel={onUp}
                            style={GRAB}
                        >
                            <title>Scale all axes</title>
                        </circle>
                    )}

                    {/* The trackball, drawn as a cube so its orientation
                        reads. One fill for all six faces, so a repaint writes
                        only geometry; it takes the axis colour while that arc
                        is spun. paintCube writes each `d`. */}
                    <g
                        fill={
                            spinningAxis
                                ? AXIS_COLOR[spinningAxis]
                                : 'var(--c-contrast)'
                        }
                        stroke="var(--c-surface)"
                        strokeWidth={1}
                        strokeLinejoin="round"
                        opacity={holdingHub || spinningAxis ? 1 : 0.9}
                        pointerEvents="none"
                    >
                        {CUBE_FACE_KEYS.map((key) => (
                            <path key={key} ref={keepFace(key)} />
                        ))}
                    </g>

                    {/* A transparent disc is the handle: a more forgiving
                        target than the silhouette, and one shape as it turns. */}
                    <circle
                        cx={CENTRE}
                        cy={CENTRE}
                        r={HUB_RADIUS}
                        fill="transparent"
                        data-handle="hub"
                        onPointerDown={onDown}
                        onPointerMove={onMove}
                        onPointerUp={onUp}
                        onPointerCancel={onUp}
                        style={GRAB}
                    >
                        <title>Free rotate</title>
                    </circle>
                </svg>
            </div>
            <ToolTip
                text={coneAction === 'move' ? 'Move' : 'Scale'}
                position="left"
                delay={100}
            >
                <button
                    onClick={() =>
                        setConeAction(coneAction === 'move' ? 'scale' : 'move')
                    }
                    className="flex cursor-pointer justify-center rounded-[8px] border-[1px] border-line/25 bg-surface p-[8px] text-ink drop-shadow-xl hover:bg-surface-3"
                >
                    {coneAction === 'move' ? (
                        <IconArrowsMove
                            color="currentColor"
                            size={16}
                            stroke={1.5}
                        />
                    ) : (
                        <IconArrowsMaximize
                            color="currentColor"
                            size={16}
                            stroke={1.5}
                        />
                    )}
                </button>
            </ToolTip>
        </div>
    )
}

export default memo(Joystick)
