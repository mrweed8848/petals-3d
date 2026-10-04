import { useRef, useState, useCallback, useEffect, memo } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { useShallow } from 'zustand/react/shallow'

import { canvasDrawStore } from '../../hooks/useCanvasDrawStore'
import { canvasRenderStore } from '../../hooks/useRenderSceneStore'

import {
    smoothArray,
    smoothPoints,
    getMirroredPoint,
    getActiveMaterial,
    applyTensionToPoints,
    getActiveMirrorModes,
    getAdaptiveStrokeWidth,
    updateStrokeStrip,
    createInitialLineMesh as createStrokeMesh,
    intersectPlaneAtPointer,
    generateCirclePointsWorld,
    getSnappedLinePointsInPlane,
    generateSemiCircleOpenArcWorld,
} from '../../helpers/drawHelper'

import { saveLines, saveSceneMeta } from '../../db/storage'
import { cloneLineRecord } from '../../helpers/records'
import { historyBusy, pushHistory } from '../../helpers/historyCapture'
import type {
    LineRecord,
    MirrorAxis,
    MirrorStrokeData,
    StripId,
    StrokeSample,
    StrokeWidth,
} from '../../types/domain'

/** The four faces of a stroke tube, built separately and merged on pointer-up. */
const STRIPS = [0, 1, 2, 3] as const

type StripMeshes = (THREE.Mesh | null)[]

const emptyStripMeshes = (): StripMeshes => [null, null, null, null]

const emptyMirrorMeshes = (): Record<MirrorAxis, StripMeshes> => ({
    X: emptyStripMeshes(),
    Y: emptyStripMeshes(),
    Z: emptyStripMeshes(),
})

/**
 * The stroke engine (main drawing helper integration)
 * Samples the pointer onto the active guide surface, builds solid tube
 * geometry from those samples, and merges the four faces into one mesh when
 * the stroke ends.
 */
const DrawLine = () => {
    const { camera, scene, gl } = useThree()
    const planeRef = useRef<THREE.Mesh>(null)

    const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const lastPointRef = useRef<THREE.Vector3 | null>(null)
    const tensionModeRef = useRef(false)
    const initialTensionYRef = useRef(0)
    const [, setTension] = useState(0.05)

    // Pre-tension snapshot, so the effect is continuous rather than
    // destructive as the pointer moves.
    const originalPointsRef = useRef<THREE.Vector3[]>([])
    const originalPressuresRef = useRef<number[]>([])
    const originalNormalsRef = useRef<THREE.Vector3[]>([])
    const originalStrokeWidthsRef = useRef<StrokeWidth[]>([])
    const originalMirrorDataRef = useRef<
        Partial<
            Record<
                MirrorAxis,
                MirrorStrokeData & { strokeWidths: StrokeWidth[] }
            >
        >
    >({})

    const pointsRef = useRef<THREE.Vector3[]>([])
    const pressuresRef = useRef<number[]>([])
    const normalsRef = useRef<THREE.Vector3[]>([])
    const currentMeshRef = useRef<StripMeshes>(emptyStripMeshes())
    const startPointRef = useRef<THREE.Vector3 | null>(null)
    const currentNormalRef = useRef<THREE.Vector3 | null>(null)
    const isDrawingRef = useRef(false)
    const mirrorDataRef = useRef<Partial<Record<MirrorAxis, MirrorStrokeData>>>(
        {}
    )
    const mirrorMeshesRef =
        useRef<Record<MirrorAxis, StripMeshes>>(emptyMirrorMeshes())

    // The guide plane's world matrix is cached for the duration of a stroke,
    // so the mirror stays fixed even if the plane moves mid-stroke.
    const cachedWorldMatrixRef = useRef<THREE.Matrix4 | null>(null)
    const cachedWorldMatrixInverseRef = useRef<THREE.Matrix4 | null>(null)

    const {
        mirror,
        penActive,
        strokeType,
        pointerType,
        strokeColor,
        strokeWidth,
        pressureMode,
        drawShapeType,
        strokeOpacity,
        activeMaterialType,
        strokeStablePercentage,
        dynamicDrawingPlaneMesh,
    } = canvasDrawStore(
        useShallow((state) => ({
            mirror: state.mirror,
            penActive: state.penActive,
            strokeType: state.strokeType,
            pointerType: state.pointerType,
            strokeColor: state.strokeColor,
            strokeWidth: state.strokeWidth,
            pressureMode: state.pressureMode,
            drawShapeType: state.drawShapeType,
            strokeOpacity: state.strokeOpacity,
            activeMaterialType: state.activeMaterialType,
            strokeStablePercentage: state.strokeStablePercentage,
            dynamicDrawingPlaneMesh: state.dynamicDrawingPlaneMesh,
        }))
    )

    const { activeGroup, groupData, setGroupData } = canvasRenderStore(
        useShallow((state) => ({
            activeGroup: state.activeGroup,
            groupData: state.groupData,
            setGroupData: state.setGroupData,
        }))
    )

    const MAX_POINTS = 50000
    const HOLD_DURATION = 1000
    const HOLD_THRESHOLD = 0.02
    const DISTANCE_THRESHOLD = 0.01
    const TENSION_SENSITIVITY = 0.005
    const OPTIMIZATION_THRESHOLD = 0.05
    const SMOOTH_PERCENTAGE = strokeStablePercentage

    const isMirroring = mirror.x || mirror.y || mirror.z
    const activeMirrorModes = isMirroring ? getActiveMirrorModes(mirror) : []

    useEffect(() => {
        return () => {
            clearHoldTimer()
        }
    }, [])

    const getPlaneIntersection = useCallback(
        (event: PointerEvent): StrokeSample | null => {
            const plane = planeRef.current
            if (!plane) return null
            return intersectPlaneAtPointer(event, gl.domElement, camera, plane)
        },
        [camera, gl]
    )

    /**
     * Rebuilds one strip from a tensioned point set, reusing the widths
     * captured before tension mode began.
     */
    function updateLineWithTensionAndStoredWidths(
        stripId: StripId,
        mesh: THREE.Mesh | null,
        tensionedPoints: THREE.Vector3[],
        normals: THREE.Vector3[],
        storedWidths: StrokeWidth[]
    ): void {
        if (!mesh) return
        if (tensionedPoints.length < 2) return

        const geometry = mesh.geometry

        let pts = tensionedPoints
        let finalNormals = normals
        let finalWidths = storedWidths

        if (pts.length >= 2) {
            const filteredPts: THREE.Vector3[] = [pts[0]!]
            const filteredNormals: THREE.Vector3[] = [normals[0]!]
            const filteredWidths: StrokeWidth[] = [storedWidths[0]!]

            let lastKeptIndex = 0

            for (let i = 1; i < pts.length; i++) {
                if (
                    pts[i]!.distanceTo(pts[lastKeptIndex]!) >=
                    OPTIMIZATION_THRESHOLD
                ) {
                    filteredPts.push(pts[i]!)
                    filteredNormals.push(normals[i]!)
                    filteredWidths.push(storedWidths[i]!)
                    lastKeptIndex = i
                }
            }

            if (lastKeptIndex !== pts.length - 1) {
                filteredPts.push(pts[pts.length - 1]!)
                filteredNormals.push(normals[normals.length - 1]!)
                filteredWidths.push(storedWidths[storedWidths.length - 1]!)
            }

            pts = filteredPts
            finalNormals = filteredNormals
            finalWidths = filteredWidths
        }

        if (pts.length < 2) return

        const positions: number[] = []
        const meshNormals: number[] = []
        const indices: number[] = []

        const tangents: THREE.Vector3[] = []
        for (let i = 0; i < pts.length - 1; i++) {
            tangents.push(
                new THREE.Vector3().subVectors(pts[i + 1]!, pts[i]!).normalize()
            )
        }

        if (tangents.length === 0) {
            tangents.push(new THREE.Vector3(1, 0, 0))
        }

        const fallbackNormal = new THREE.Vector3(0, 1, 0)
        const firstNormal = finalNormals[0] ?? fallbackNormal
        const firstTangent = tangents[0]!

        const transportedRights: THREE.Vector3[] = []
        const right = new THREE.Vector3()
            .crossVectors(firstNormal, firstTangent)
            .normalize()

        if (right.lengthSq() < 1e-6) {
            right.set(0, 1, 0)
            if (Math.abs(firstTangent.dot(right)) > 0.99) right.set(1, 0, 0)
            right.crossVectors(firstNormal, firstTangent).normalize()
        }
        transportedRights.push(right.clone())

        for (let i = 1; i < tangents.length; i++) {
            const prevT = tangents[i - 1]!
            const currT = tangents[i]!
            const axis = new THREE.Vector3().crossVectors(prevT, currT)
            const angle = Math.acos(
                THREE.MathUtils.clamp(prevT.dot(currT), -1, 1)
            )

            if (axis.lengthSq() < 1e-6 || angle === 0) {
                transportedRights.push(transportedRights[i - 1]!.clone())
            } else {
                const q = new THREE.Quaternion().setFromAxisAngle(
                    axis.normalize(),
                    angle
                )
                transportedRights.push(
                    transportedRights[i - 1]!.clone()
                        .applyQuaternion(q)
                        .normalize()
                )
            }
        }

        for (let i = 0; i < pts.length; i++) {
            const curr = pts[i]!
            const tangent =
                i === pts.length - 1
                    ? (tangents[i - 1] ?? firstTangent)
                    : (tangents[i] ?? firstTangent)
            const rightVec =
                transportedRights[i] ??
                transportedRights[transportedRights.length - 1]!
            const up = new THREE.Vector3()
                .crossVectors(tangent, rightVec)
                .normalize()

            const widthIndex = Math.min(i, finalWidths.length - 1)
            const halfW = finalWidths[widthIndex]!.w
            const halfH = finalWidths[widthIndex]!.h

            const tl = new THREE.Vector3()
                .copy(curr)
                .addScaledVector(rightVec, -halfW)
                .addScaledVector(up, halfH)
            const tr = new THREE.Vector3()
                .copy(curr)
                .addScaledVector(rightVec, halfW)
                .addScaledVector(up, halfH)
            const br = new THREE.Vector3()
                .copy(curr)
                .addScaledVector(rightVec, halfW)
                .addScaledVector(up, -halfH)
            const bl = new THREE.Vector3()
                .copy(curr)
                .addScaledVector(rightVec, -halfW)
                .addScaledVector(up, -halfH)

            const normal = (finalNormals[i] ?? firstNormal).clone()
            const baseIdx = positions.length / 3

            for (const v of [tl, tr, br, bl, tl, tr, br, bl]) {
                positions.push(v.x, v.y, v.z)
                meshNormals.push(normal.x, normal.y, normal.z)
            }

            if (i > 0) {
                const prevBase = baseIdx - 4
                if (stripId === 0) {
                    indices.push(prevBase, prevBase + 1, baseIdx + 1)
                    indices.push(prevBase, baseIdx + 1, baseIdx)
                }
                if (stripId === 1) {
                    indices.push(prevBase + 1, prevBase + 2, baseIdx + 2)
                    indices.push(prevBase + 1, baseIdx + 2, baseIdx + 1)
                }
                if (stripId === 2) {
                    indices.push(prevBase + 2, prevBase + 3, baseIdx + 3)
                    indices.push(prevBase + 2, baseIdx + 3, baseIdx + 2)
                }
                if (stripId === 3) {
                    indices.push(prevBase + 3, prevBase, baseIdx)
                    indices.push(prevBase + 3, baseIdx, baseIdx + 3)
                }
            }
        }

        geometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(positions, 3)
        )
        geometry.setAttribute(
            'normal',
            new THREE.Float32BufferAttribute(meshNormals, 3)
        )
        geometry.setIndex(indices)

        geometry.attributes.position!.needsUpdate = true
        geometry.attributes.normal!.needsUpdate = true
        if (geometry.index) geometry.index.needsUpdate = true
        geometry.setDrawRange(0, indices.length)

        const material = mesh.material
        if (Array.isArray(material)) {
            material.forEach((m) => (m.needsUpdate = true))
        } else {
            material.needsUpdate = true
        }
    }

    const updateTensionAndLine = useCallback(
        (clientY: number) => {
            if (!tensionModeRef.current) return

            const deltaY = initialTensionYRef.current - clientY
            const newTension = THREE.MathUtils.clamp(
                0.5 + deltaY * TENSION_SENSITIVITY,
                0,
                1
            )
            setTension(newTension)

            if (drawShapeType !== 'free_hand') return
            if (originalPointsRef.current.length === 0) return

            const tensionedPoints = applyTensionToPoints(
                originalPointsRef.current,
                newTension
            )

            if (originalStrokeWidthsRef.current.length > 0) {
                for (const stripId of STRIPS) {
                    const mesh = currentMeshRef.current[stripId]
                    if (!mesh) continue

                    updateLineWithTensionAndStoredWidths(
                        stripId,
                        mesh,
                        tensionedPoints,
                        originalNormalsRef.current,
                        originalStrokeWidthsRef.current
                    )

                    mesh.userData.points = tensionedPoints.map((p) => p.clone())
                    mesh.userData.normals = originalNormalsRef.current.map(
                        (n) => n.clone()
                    )
                    mesh.userData.pressures = [...originalPressuresRef.current]
                }
            }

            activeMirrorModes.forEach((mode) => {
                const originalMirrorData = originalMirrorDataRef.current[mode]
                if (!originalMirrorData) return

                const tensionedMirrorPoints = applyTensionToPoints(
                    originalMirrorData.points,
                    newTension
                )

                for (const stripId of STRIPS) {
                    const mesh = mirrorMeshesRef.current[mode][stripId]
                    if (!mesh) continue

                    updateLineWithTensionAndStoredWidths(
                        stripId,
                        mesh,
                        tensionedMirrorPoints,
                        originalMirrorData.normals,
                        originalMirrorData.strokeWidths
                    )

                    mesh.userData.points = tensionedMirrorPoints.map((p) =>
                        p.clone()
                    )
                    mesh.userData.normals = originalMirrorData.normals.map(
                        (n) => n.clone()
                    )
                    mesh.userData.pressures = [...originalMirrorData.pressures]
                }
            })
        },
        [drawShapeType, isMirroring]
    )

    /**
     * An empty mesh sized for the worst case, filled in by `updateLine`.
     *
     * The original took `(mirror, stripId)` but was always called with a
     * single object, so `stripId` was undefined and its visibility branch
     * could never fire. Mirror strips were therefore never hidden here, and
     * that is preserved: the four strips merge on pointer-up anyway.
     */
    function createInitialLineMesh(): THREE.Mesh {
        const mesh = createStrokeMesh(
            strokeColor,
            strokeOpacity,
            activeMaterialType,
            MAX_POINTS,
            false,
            0
        )
        scene.add(mesh)
        return mesh
    }

    /**
     * Press and hold mid-stroke to enter tension mode, where vertical pointer
     * movement straightens the curve by feel.
     */
    const startHoldTimer = (point: THREE.Vector3) => {
        if (drawShapeType !== 'free_hand') return

        lastPointRef.current = point.clone()

        holdTimerRef.current = setTimeout(() => {
            tensionModeRef.current = true

            if (pointsRef.current.length === 0) return

            const smoothed = smoothPoints(
                [...pointsRef.current],
                SMOOTH_PERCENTAGE
            )
            const smoothedPressures = smoothArray(
                [...pressuresRef.current],
                SMOOTH_PERCENTAGE
            )

            originalPointsRef.current = smoothed.map((p) => p.clone())
            originalPressuresRef.current = [...smoothedPressures]
            originalNormalsRef.current = [...normalsRef.current]

            originalStrokeWidthsRef.current = smoothed.map((_, i) =>
                widthAt(smoothedPressures, i, smoothed.length)
            )

            originalMirrorDataRef.current = {}

            activeMirrorModes.forEach((mode) => {
                const mirrorData = mirrorDataRef.current[mode]
                if (!mirrorData || mirrorData.points.length === 0) return

                const smoothedMirrorPoints = smoothPoints(
                    [...mirrorData.points],
                    SMOOTH_PERCENTAGE
                )
                const smoothedMirrorPressures = smoothArray(
                    [...mirrorData.pressures],
                    SMOOTH_PERCENTAGE
                )

                originalMirrorDataRef.current[mode] = {
                    points: smoothedMirrorPoints.map((p) => p.clone()),
                    pressures: [...smoothedMirrorPressures],
                    normals: [...mirrorData.normals],
                    strokeWidths: smoothedMirrorPoints.map((_, i) =>
                        widthAt(
                            smoothedMirrorPressures,
                            i,
                            smoothedMirrorPoints.length
                        )
                    ),
                }
            })
        }, HOLD_DURATION)
    }

    /** Brush half-extents at sample `i`, with the taper envelope applied. */
    function widthAt(
        pressures: number[],
        i: number,
        length: number
    ): StrokeWidth {
        let taperFactor = 1
        if (strokeType === 'taper') {
            const t = length > 1 ? i / (length - 1) : 0
            taperFactor = Math.sin(t * Math.PI)
        }
        return getAdaptiveStrokeWidth(
            strokeType,
            (pressures[i] ?? 1) * taperFactor,
            strokeWidth
        )
    }

    const clearHoldTimer = () => {
        if (holdTimerRef.current) {
            clearTimeout(holdTimerRef.current)
            holdTimerRef.current = null
        }
    }

    /** Builds one strip of the live stroke from raw samples. */
    function updateLine(
        stripId: StripId,
        mesh: THREE.Mesh | null,
        rawPts: THREE.Vector3[],
        pressuresArr: number[],
        normalsArr: THREE.Vector3[]
    ): void {
        if (!mesh) return

        updateStrokeStrip(
            stripId,
            OPTIMIZATION_THRESHOLD,
            SMOOTH_PERCENTAGE,
            drawShapeType,
            mesh,
            strokeWidth,
            strokeOpacity,
            strokeType,
            strokeColor,
            rawPts,
            pressuresArr,
            normalsArr,
            !tensionModeRef.current
        )
    }

    /** Rebuilds every strip of the primary stroke and each mirrored copy. */
    function redrawAll(
        pts: THREE.Vector3[],
        pressures: number[],
        normals: THREE.Vector3[]
    ): void {
        for (const stripId of STRIPS) {
            updateLine(
                stripId,
                currentMeshRef.current[stripId],
                pts,
                pressures,
                normals
            )
        }

        activeMirrorModes.forEach((mode) => {
            const data = mirrorDataRef.current[mode]
            if (!data) return
            for (const stripId of STRIPS) {
                updateLine(
                    stripId,
                    mirrorMeshesRef.current[mode][stripId],
                    data.points,
                    data.pressures,
                    data.normals
                )
            }
        })
    }

    function startDrawing(event: PointerEvent): void {
        // Nothing may touch the scene while an undo is being applied, or the
        // stroke would land half inside the operation being reversed.
        if (historyBusy()) return
        if (event.pointerType !== pointerType) return
        if (!planeRef.current) return

        isDrawingRef.current = true
        tensionModeRef.current = false
        setTension(0.5)

        originalPointsRef.current = []
        originalPressuresRef.current = []
        originalNormalsRef.current = []
        originalStrokeWidthsRef.current = []
        originalMirrorDataRef.current = {}
        pointsRef.current = []
        pressuresRef.current = []
        normalsRef.current = []
        mirrorDataRef.current = {}

        cachedWorldMatrixRef.current = null
        cachedWorldMatrixInverseRef.current = null

        const intersection = getPlaneIntersection(event)
        if (!intersection) return

        startPointRef.current = intersection.point.clone()
        currentNormalRef.current = intersection.normal.clone()

        for (const stripId of STRIPS) {
            currentMeshRef.current[stripId] = createInitialLineMesh()
        }

        activeMirrorModes.forEach((mode) => {
            for (const stripId of STRIPS) {
                mirrorMeshesRef.current[mode][stripId] = createInitialLineMesh()
            }
            mirrorDataRef.current[mode] = {
                points: [],
                pressures: [],
                normals: [],
            }
        })

        const pressure = pressureMode ? event.pressure : 1.0

        pointsRef.current.push(startPointRef.current.clone())
        pressuresRef.current.push(pressure)
        normalsRef.current.push(currentNormalRef.current)

        activeMirrorModes.forEach((mode) => {
            const { mirroredPoint, mirroredNormal } = getMirroredPoint(
                cachedWorldMatrixInverseRef,
                cachedWorldMatrixRef,
                startPointRef.current!,
                currentNormalRef.current!,
                mode,
                planeRef.current!
            )
            const data = mirrorDataRef.current[mode]
            if (!data) return
            data.points.push(mirroredPoint.clone())
            data.pressures.push(pressure)
            data.normals.push(mirroredNormal)
        })

        startHoldTimer(startPointRef.current)
        initialTensionYRef.current = event.clientY

        // Free-hand needs a second point before any geometry can be built.
        if (drawShapeType === 'free_hand') {
            const secondPoint = new THREE.Vector3()
                .copy(startPointRef.current)
                .addScalar(0.001)
            pointsRef.current.push(secondPoint)
            pressuresRef.current.push(pressure)
            normalsRef.current.push(currentNormalRef.current)

            activeMirrorModes.forEach((mode) => {
                const {
                    mirroredPoint: mirrorSecondPoint,
                    mirroredNormal: mirrorSecondNormal,
                } = getMirroredPoint(
                    cachedWorldMatrixInverseRef,
                    cachedWorldMatrixRef,
                    secondPoint,
                    currentNormalRef.current!,
                    mode,
                    planeRef.current!
                )
                const data = mirrorDataRef.current[mode]
                if (!data) return
                data.points.push(mirrorSecondPoint)
                data.pressures.push(pressure)
                data.normals.push(mirrorSecondNormal)
            })
        }

        redrawAll(pointsRef.current, pressuresRef.current, normalsRef.current)
    }

    function continueDrawing(event: PointerEvent): void {
        if (event.pointerType !== pointerType) return
        if (!isDrawingRef.current || !planeRef.current) return

        if (tensionModeRef.current) {
            updateTensionAndLine(event.clientY)
            return
        }

        const intersection = getPlaneIntersection(event)
        if (!intersection) return

        const { point, normal } = intersection

        // Moving far enough restarts the hold timer, so tension mode only
        // triggers when the pointer actually rests.
        if (drawShapeType === 'free_hand' && lastPointRef.current) {
            if (point.distanceTo(lastPointRef.current) > HOLD_THRESHOLD) {
                clearHoldTimer()
                startHoldTimer(point)
                initialTensionYRef.current = event.clientY
            }
        }

        const pressure = pressureMode ? event.pressure : 1.0

        if (drawShapeType === 'free_hand') {
            const newPoint = point.clone()
            const last = pointsRef.current[pointsRef.current.length - 1]
            if (last && newPoint.distanceTo(last) < DISTANCE_THRESHOLD) return

            pointsRef.current.push(newPoint)
            pressuresRef.current.push(pressure)
            normalsRef.current.push(normal)

            activeMirrorModes.forEach((mode) => {
                const { mirroredPoint, mirroredNormal } = getMirroredPoint(
                    cachedWorldMatrixInverseRef,
                    cachedWorldMatrixRef,
                    newPoint,
                    normal,
                    mode,
                    planeRef.current!
                )
                const data = mirrorDataRef.current[mode]
                if (!data) return
                data.points.push(mirroredPoint)
                data.pressures.push(pressure)
                data.normals.push(mirroredNormal)
            })

            if (pointsRef.current.length > MAX_POINTS) {
                pointsRef.current.shift()
                pressuresRef.current.shift()
                normalsRef.current.shift()
                activeMirrorModes.forEach((mode) => {
                    const data = mirrorDataRef.current[mode]
                    if (!data) return
                    data.points.shift()
                    data.pressures.shift()
                    data.normals.shift()
                })
            }

            redrawAll(
                pointsRef.current,
                pressuresRef.current,
                normalsRef.current
            )
        } else if (drawShapeType === 'straight') {
            const startPoint = startPointRef.current
            const startNormal = currentNormalRef.current
            if (!startPoint || !startNormal) return

            const { snappedEnd } = getSnappedLinePointsInPlane({
                startPoint,
                currentPoint: point,
                normal,
                camera,
                snapAngle: 1,
                pointDensity: 0.05,
            })

            pointsRef.current.length = 0
            pressuresRef.current.length = 0
            normalsRef.current.length = 0

            // Taper needs interior samples for the envelope to show; the
            // other brushes only need the ends and a midpoint.
            if (strokeType === 'taper') {
                const positions = [
                    0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0,
                ]

                positions.forEach((t) => {
                    pointsRef.current.push(
                        new THREE.Vector3().lerpVectors(
                            startPoint,
                            snappedEnd,
                            t
                        )
                    )
                    pressuresRef.current.push(pressure)
                    normalsRef.current.push(
                        new THREE.Vector3()
                            .lerpVectors(startNormal, normal, t)
                            .normalize()
                    )
                })
            } else {
                const middlePoint = new THREE.Vector3().lerpVectors(
                    startPoint,
                    snappedEnd,
                    0.5
                )

                pointsRef.current.push(
                    startPoint.clone(),
                    middlePoint,
                    snappedEnd.clone()
                )
                pressuresRef.current.push(pressure, pressure, pressure)
                normalsRef.current.push(
                    startNormal.clone(),
                    normal.clone(),
                    normal.clone()
                )
            }

            for (const stripId of STRIPS) {
                updateLine(
                    stripId,
                    currentMeshRef.current[stripId],
                    pointsRef.current,
                    pressuresRef.current,
                    normalsRef.current
                )
            }

            activeMirrorModes.forEach((mode) => {
                const {
                    mirroredPoint: mirroredStart,
                    mirroredNormal: mirroredNormal1,
                } = getMirroredPoint(
                    cachedWorldMatrixInverseRef,
                    cachedWorldMatrixRef,
                    startPoint,
                    startNormal,
                    mode,
                    planeRef.current!
                )

                const {
                    mirroredPoint: mirroredEnd,
                    mirroredNormal: mirroredNormal2,
                } = getMirroredPoint(
                    cachedWorldMatrixInverseRef,
                    cachedWorldMatrixRef,
                    snappedEnd,
                    normal,
                    mode,
                    planeRef.current!
                )

                const data: MirrorStrokeData = {
                    points: [],
                    pressures: [],
                    normals: [],
                }

                if (strokeType === 'taper') {
                    const positions = [0, 0.25, 0.5, 0.75, 1.0]

                    positions.forEach((t) => {
                        data.points.push(
                            new THREE.Vector3().lerpVectors(
                                mirroredStart,
                                mirroredEnd,
                                t
                            )
                        )
                        data.pressures.push(pressure)
                        data.normals.push(
                            new THREE.Vector3()
                                .lerpVectors(
                                    mirroredNormal1,
                                    mirroredNormal2,
                                    t
                                )
                                .normalize()
                        )
                    })
                } else {
                    const mirroredMiddle = new THREE.Vector3().lerpVectors(
                        mirroredStart,
                        mirroredEnd,
                        0.5
                    )

                    data.points = [mirroredStart, mirroredMiddle, mirroredEnd]
                    data.pressures = [pressure, pressure, pressure]
                    data.normals = [
                        mirroredNormal1,
                        mirroredNormal2,
                        mirroredNormal2,
                    ]
                }

                mirrorDataRef.current[mode] = data

                for (const stripId of STRIPS) {
                    updateLine(
                        stripId,
                        mirrorMeshesRef.current[mode][stripId],
                        data.points,
                        data.pressures,
                        data.normals
                    )
                }
            })
        } else if (drawShapeType === 'circle' || drawShapeType === 'arc') {
            const center = startPointRef.current
            const centerNormal = currentNormalRef.current
            if (!center || !centerNormal) return

            const radius = center.distanceTo(point)
            const shape = generateShape(
                drawShapeType,
                center,
                centerNormal,
                radius
            )
            const shapePressures = Array<number>(shape.points.length).fill(
                pressure
            )

            for (const stripId of STRIPS) {
                updateLine(
                    stripId,
                    currentMeshRef.current[stripId],
                    shape.points,
                    shapePressures,
                    shape.normals
                )
            }

            activeMirrorModes.forEach((mode) => {
                const {
                    mirroredPoint: mirrorCenter,
                    mirroredNormal: mirrorNormal,
                } = getMirroredPoint(
                    cachedWorldMatrixInverseRef,
                    cachedWorldMatrixRef,
                    center,
                    centerNormal,
                    mode,
                    planeRef.current!
                )

                const mirrorShape = generateShape(
                    drawShapeType,
                    mirrorCenter,
                    mirrorNormal,
                    radius
                )
                const mirrorPressures = Array<number>(
                    mirrorShape.points.length
                ).fill(pressure)

                for (const stripId of STRIPS) {
                    updateLine(
                        stripId,
                        mirrorMeshesRef.current[mode][stripId],
                        mirrorShape.points,
                        mirrorPressures,
                        mirrorShape.normals
                    )
                }

                mirrorDataRef.current[mode] = {
                    points: mirrorShape.points,
                    pressures: mirrorPressures,
                    normals: mirrorShape.normals,
                }
            })
        }
    }

    /** Analytic circle or arc about a centre, in the plane of `normal`. */
    function generateShape(
        shape: 'circle' | 'arc',
        center: THREE.Vector3,
        normal: THREE.Vector3,
        radius: number
    ): { points: THREE.Vector3[]; normals: THREE.Vector3[] } {
        if (shape === 'circle') {
            const { circlePoints, circleNormals } = generateCirclePointsWorld(
                center,
                normal,
                radius
            )
            return { points: circlePoints, normals: circleNormals }
        }

        const { arcPoints, arcNormals } = generateSemiCircleOpenArcWorld(
            center,
            normal,
            radius
        )
        return { points: arcPoints, normals: arcNormals }
    }

    /** Merges the four strips into one mesh and disposes the temporaries. */
    function mergeStrips(meshes: StripMeshes): THREE.BufferGeometry | null {
        const geometries: THREE.BufferGeometry[] = []

        for (const mesh of meshes) {
            if (!mesh) continue
            mesh.updateMatrixWorld(true)
            geometries.push(mesh.geometry.clone())

            scene.remove(mesh)
            mesh.geometry.dispose()
            const material = mesh.material
            if (Array.isArray(material)) {
                material.forEach((m) => m.dispose())
            } else {
                material.dispose()
            }
        }

        if (geometries.length === 0) return null

        const mergedGeo = BufferGeometryUtils.mergeGeometries(geometries, false)
        geometries.forEach((g) => g.dispose())

        const finalGeo = mergedGeo.toNonIndexed()
        mergedGeo.dispose()

        finalGeo.computeVertexNormals()
        finalGeo.computeBoundingBox()
        finalGeo.computeBoundingSphere()

        return finalGeo
    }

    /** Assembles the persisted record for a finished stroke. */
    function buildRecord(
        points: THREE.Vector3[],
        normals: THREE.Vector3[],
        pressures: number[],
        meshUuid: string,
        isMirror: boolean,
        visible: boolean
    ): LineRecord {
        return {
            type: 'LINE',
            is_deleted: false,
            is_mirror: isMirror,
            mirror_mode: 'NA',
            points,
            normals,
            pressures,
            loft_points: points,
            optimization_threshold: OPTIMIZATION_THRESHOLD,
            smooth_percentage: SMOOTH_PERCENTAGE,
            color: strokeColor,
            width: strokeWidth,
            opacity: strokeOpacity,
            stroke_type: strokeType,
            shape_type: drawShapeType,
            uuid: meshUuid,
            group_id: activeGroup!.uuid,
            material_type: activeMaterialType,
            position: new THREE.Vector3(0, 0, 0),
            rotation: new THREE.Quaternion(0, 0, 0, 1),
            scale: new THREE.Vector3(1, 1, 1),
            visible,
        }
    }

    function resetStroke(): void {
        currentMeshRef.current = emptyStripMeshes()
        mirrorMeshesRef.current = emptyMirrorMeshes()
        mirrorDataRef.current = {}
        startPointRef.current = null
        currentNormalRef.current = null
        isDrawingRef.current = false
    }

    async function stopDrawing(event: PointerEvent): Promise<void> {
        clearHoldTimer()

        if (!isDrawingRef.current || !planeRef.current) return

        if (tensionModeRef.current) {
            tensionModeRef.current = false

            // The original also tried to read points back off
            // `currentMeshRef.current.userData` here, but that ref holds an
            // array of four meshes, so the guard was never true and the block
            // never ran. Only the mirror restore below ever executed.
            activeMirrorModes.forEach((mode) => {
                for (const stripId of STRIPS) {
                    const mesh = mirrorMeshesRef.current[mode][stripId]
                    const stored = mesh?.userData as
                        Partial<MirrorStrokeData> | undefined
                    if (!stored?.points || !stored.normals || !stored.pressures)
                        continue

                    mirrorDataRef.current[mode] = {
                        points: stored.points.map((p) => p.clone()),
                        pressures: [...stored.pressures],
                        normals: stored.normals.map((n) => n.clone()),
                    }
                }
            })

            originalPointsRef.current = []
            originalPressuresRef.current = []
            originalNormalsRef.current = []
            originalStrokeWidthsRef.current = []
            originalMirrorDataRef.current = {}
        }

        let ogLineData: LineRecord | undefined
        const mirrorLineData: LineRecord[] = []

        if (drawShapeType === 'free_hand' || drawShapeType === 'straight') {
            if (!startPointRef.current || pointsRef.current.length < 2) {
                currentMeshRef.current.forEach((mesh) => {
                    if (mesh) scene.remove(mesh)
                })
                Object.values(mirrorMeshesRef.current).forEach((strips) => {
                    strips.forEach((mesh) => {
                        if (mesh) scene.remove(mesh)
                    })
                })
                resetStroke()
                return
            }

            const finalGeo = mergeStrips(currentMeshRef.current)
            if (!finalGeo) {
                resetStroke()
                return
            }

            const combinedMesh = new THREE.Mesh(
                finalGeo,
                getActiveMaterial(
                    activeMaterialType,
                    strokeOpacity,
                    strokeColor
                )
            )
            combinedMesh.position.set(0, 0, 0)
            combinedMesh.quaternion.identity()
            combinedMesh.scale.set(1, 1, 1)
            combinedMesh.updateMatrixWorld(true)

            ogLineData = buildRecord(
                pointsRef.current,
                normalsRef.current,
                pressuresRef.current,
                combinedMesh.uuid,
                false,
                combinedMesh.visible
            )

            // The mesh's userData and the stored record are the same object.
            combinedMesh.userData = ogLineData
            scene.add(combinedMesh)

            activeMirrorModes.forEach((mode) => {
                const data = mirrorDataRef.current[mode]
                if (!data) return

                const mirrorGeo = mergeStrips(mirrorMeshesRef.current[mode])
                if (!mirrorGeo) return

                const combinedMirrorMesh = new THREE.Mesh(
                    mirrorGeo,
                    getActiveMaterial(
                        activeMaterialType,
                        strokeOpacity,
                        strokeColor
                    )
                )

                const mData = buildRecord(
                    data.points,
                    data.normals,
                    data.pressures,
                    combinedMirrorMesh.uuid,
                    true,
                    combinedMesh.visible
                )

                mirrorLineData.push(mData)
                combinedMirrorMesh.userData = mData
                scene.add(combinedMirrorMesh)
            })
        } else if (drawShapeType === 'circle' || drawShapeType === 'arc') {
            const center = startPointRef.current
            const centerNormal = currentNormalRef.current
            if (!center || !centerNormal) {
                resetStroke()
                return
            }

            const lastPoint =
                getPlaneIntersection(event)?.point ??
                pointsRef.current[pointsRef.current.length - 1] ??
                center
            const radius = center.distanceTo(lastPoint)

            const shape = generateShape(
                drawShapeType,
                center,
                centerNormal,
                radius
            )
            const finalPressures = Array<number>(shape.points.length).fill(
                pressuresRef.current[0] ?? 1.0
            )

            const finalGeo = mergeStrips(currentMeshRef.current)
            if (!finalGeo) {
                resetStroke()
                return
            }

            const combinedMesh = new THREE.Mesh(
                finalGeo,
                getActiveMaterial(
                    activeMaterialType,
                    strokeOpacity,
                    strokeColor
                )
            )
            combinedMesh.position.set(0, 0, 0)
            combinedMesh.quaternion.identity()
            combinedMesh.scale.set(1, 1, 1)
            combinedMesh.updateMatrixWorld(true)

            ogLineData = buildRecord(
                shape.points,
                shape.normals,
                finalPressures,
                combinedMesh.uuid,
                false,
                combinedMesh.visible
            )

            combinedMesh.userData = ogLineData
            scene.add(combinedMesh)

            activeMirrorModes.forEach((mode) => {
                const data = mirrorDataRef.current[mode]
                if (!data) return

                const mirrorGeo = mergeStrips(mirrorMeshesRef.current[mode])
                if (!mirrorGeo) return

                const combinedMirrorMesh = new THREE.Mesh(
                    mirrorGeo,
                    getActiveMaterial(
                        activeMaterialType,
                        strokeOpacity,
                        strokeColor
                    )
                )

                const mData = buildRecord(
                    data.points,
                    data.normals,
                    data.pressures,
                    combinedMirrorMesh.uuid,
                    true,
                    combinedMesh.visible
                )

                mirrorLineData.push(mData)
                combinedMirrorMesh.userData = mData
                scene.add(combinedMirrorMesh)
            })
        }

        resetStroke()

        if (activeGroup && ogLineData) {
            activeGroup.objects.push(ogLineData)
            activeGroup.objects.push(...mirrorLineData)
        }

        setGroupData([...groupData])

        /*
         * Only the stroke just drawn, and its mirrors. Writing the whole
         * document here meant every completed stroke re-serialised every
         * stroke before it.
         */
        if (ogLineData) {
            await saveLines([ogLineData, ...mirrorLineData])

            /*
             * One entry for the stroke and every mirror of it, so a single
             * undo takes the whole gesture back rather than one strip at a
             * time. The records are cloned because the live ones belong to
             * the meshes and will keep changing.
             */
            pushHistory('Draw stroke', [
                {
                    kind: 'lines-added',
                    groupId: activeGroup?.uuid ?? '',
                    lines: [ogLineData, ...mirrorLineData].map(cloneLineRecord),
                },
            ])
        }
        await saveSceneMeta(canvasRenderStore.getState().groupData)
    }

    return (
        <>
            {dynamicDrawingPlaneMesh && (
                <primitive
                    object={dynamicDrawingPlaneMesh}
                    ref={planeRef}
                    onPointerDown={(e: { nativeEvent: PointerEvent }) =>
                        penActive && startDrawing(e.nativeEvent)
                    }
                    onPointerMove={(e: { nativeEvent: PointerEvent }) =>
                        penActive && continueDrawing(e.nativeEvent)
                    }
                    onPointerUp={(e: { nativeEvent: PointerEvent }) =>
                        penActive && void stopDrawing(e.nativeEvent)
                    }
                    onPointerOut={(e: { nativeEvent: PointerEvent }) =>
                        penActive && void stopDrawing(e.nativeEvent)
                    }
                />
            )}
        </>
    )
}

export default memo(DrawLine)
