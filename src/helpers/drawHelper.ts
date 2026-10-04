import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import type {
    DrawShapeType,
    Group,
    MaterialType,
    MirrorAxis,
    LineRecord,
    MirrorState,
    StripId,
    StrokeSample,
    StrokeType,
    StrokeWidth,
} from '../types/domain'

export type StrokeMaterial =
    THREE.MeshBasicMaterial | THREE.MeshStandardMaterial

const MAX_POINTS = 50000

export function createGuideLineMesh(
    scene: THREE.Scene,
    color: THREE.Color,
    maxPoints: number
): THREE.Mesh {
    const maxVertices = maxPoints * 4

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(maxVertices * 3), 3)
    )
    geometry.setAttribute(
        'normal',
        new THREE.BufferAttribute(new Float32Array(maxVertices * 3), 3)
    )
    geometry.setIndex(
        new THREE.BufferAttribute(new Uint32Array(maxPoints * 24), 1)
    )
    geometry.setDrawRange(0, 0)

    const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        wireframe: false,
        transparent: true,
        opacity: 1,
        side: THREE.DoubleSide,
        forceSinglePass: true,
        depthTest: true,
        depthWrite: true,
    })

    const mesh = new THREE.Mesh(geometry, material)
    mesh.userData.type = 'DYNAMIC_GUIDE_LINE'
    scene.add(mesh)
    return mesh
}

export interface GuideLineOptions {
    shapeType: DrawShapeType
    smoothPercentage: number
    optimizationThreshold: number
    color: THREE.Color
    opacity: number
}

export function updateGuideLine(
    mesh: THREE.Mesh,
    rawPts: THREE.Vector3[],
    pressuresArr: number[],
    normalsArr: THREE.Vector3[],
    options: GuideLineOptions
): void {
    const {
        shapeType,
        smoothPercentage,
        optimizationThreshold,
        color,
        opacity,
    } = options

    if (rawPts.length < 2) return

    const geometry = mesh.geometry

    let pts = rawPts
    let finalNormals = normalsArr

    if (shapeType === 'free_hand') {
        pts = smoothPoints(rawPts, smoothPercentage)
        const smoothedPressures = smoothArray(pressuresArr, smoothPercentage)
        const filteredResult = filterPoints(
            pts,
            smoothedPressures,
            normalsArr,
            optimizationThreshold
        )
        pts = filteredResult.filteredPts
        finalNormals = filteredResult.filteredNormals
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
        const angle = Math.acos(THREE.MathUtils.clamp(prevT.dot(currT), -1, 1))

        if (axis.lengthSq() < 1e-6 || angle === 0) {
            transportedRights.push(transportedRights[i - 1]!.clone())
        } else {
            const q = new THREE.Quaternion().setFromAxisAngle(
                axis.normalize(),
                angle
            )
            transportedRights.push(
                transportedRights[i - 1]!.clone().applyQuaternion(q).normalize()
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

        const halfW = 0.025
        const halfH = 0.025

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

        for (const v of [tl, tr, br, bl]) {
            positions.push(v.x, v.y, v.z)
            meshNormals.push(normal.x, normal.y, normal.z)
        }

        if (i > 0) {
            const prevBase = baseIdx - 4
            indices.push(prevBase, prevBase + 1, baseIdx + 1)
            indices.push(prevBase, baseIdx + 1, baseIdx)
            indices.push(prevBase + 1, prevBase + 2, baseIdx + 2)
            indices.push(prevBase + 1, baseIdx + 2, baseIdx + 1)
            indices.push(prevBase + 2, prevBase + 3, baseIdx + 3)
            indices.push(prevBase + 2, baseIdx + 3, baseIdx + 2)
            indices.push(prevBase + 3, prevBase, baseIdx)
            indices.push(prevBase + 3, baseIdx, baseIdx + 3)
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
    if (material instanceof THREE.MeshBasicMaterial) {
        material.color.copy(color)
        material.opacity = opacity
        material.needsUpdate = true
    }
}

const pointerRaycaster = new THREE.Raycaster()
const pointerNdc = new THREE.Vector2()

export function intersectPlaneAtPointer(
    event: PointerEvent,
    canvas: HTMLElement,
    camera: THREE.Camera,
    plane: THREE.Object3D
): StrokeSample | null {
    const rect = canvas.getBoundingClientRect()

    pointerNdc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
    )
    pointerRaycaster.setFromCamera(pointerNdc, camera)

    const intersection = pointerRaycaster.intersectObject(plane)[0]
    if (!intersection?.face) return null

    return {
        point: intersection.point.clone(),
        normal: intersection.face.normal
            .clone()
            .transformDirection(intersection.object.matrixWorld)
            .normalize(),
    }
}

export interface GenerateSceneResult {
    newGeneratedGroups: Group[]
    newScene: THREE.Scene
}

/**
 * Replays one stored stroke into a mesh. The four strips are built and merged
 * as they were at draw time, which is why the smoothing parameters are stored
 * per line: reproducing a stroke needs the values it was drawn with.
 *
 * The mesh's userData is the record itself, not a copy, so anything wanting a
 * stable snapshot of a line has to clone it. See helpers/records.ts.
 */
export const buildLineMesh = (
    scene: THREE.Scene,
    line: LineRecord
): THREE.Mesh => {
    const ogGeometries: THREE.BufferGeometry[] = []

    for (const k of [0, 1, 2, 3] as const) {
        const mesh = createInitialLineMesh(
            line.color,
            line.opacity,
            line.material_type,
            MAX_POINTS,
            line.is_mirror,
            k
        )

        updateStrokeStrip(
            k,
            line.optimization_threshold,
            line.smooth_percentage,
            line.shape_type,
            mesh,
            line.width,
            line.opacity,
            line.stroke_type,
            line.color,
            line.points,
            line.pressures,
            line.normals
        )

        ogGeometries.push(mesh.geometry.clone())

        scene.remove(mesh)
        mesh.geometry.dispose()
        disposeMaterial(mesh.material)
    }

    const mergedGeo = BufferGeometryUtils.mergeGeometries(ogGeometries, false)
    ogGeometries.forEach((g) => g.dispose())

    mergedGeo.computeVertexNormals()
    mergedGeo.computeBoundingBox()
    mergedGeo.computeBoundingSphere()

    const material = getActiveMaterial(
        line.material_type,
        line.opacity,
        line.color
    )
    const combinedMesh = new THREE.Mesh(mergedGeo, material)

    combinedMesh.scale.set(line.scale.x, line.scale.y, line.scale.z)
    combinedMesh.position.copy(line.position)
    combinedMesh.quaternion.copy(line.rotation)
    combinedMesh.userData = line

    return combinedMesh
}

/** Rebuilds every mesh in the scene from the stored line records. */
export const generateScene = (
    scene: THREE.Scene,
    gD: Group[]
): GenerateSceneResult => {
    const newGeneratedGroups: Group[] = []

    for (const group of gD) {
        if (group.deleted_at) continue

        for (const line of group.objects) {
            if (line.is_deleted) continue
            scene.add(buildLineMesh(scene, line))
        }

        group.objects = group.objects.filter((line) => !line.is_deleted)
        newGeneratedGroups.push(group)
    }

    return { newGeneratedGroups, newScene: scene }
}

export function updateStrokeStrip(
    stripId: StripId,
    optimizationThreshold: number,
    smoothPercentage: number,
    shapeType: DrawShapeType,
    mesh: THREE.Mesh,
    width: number,
    strokeOpacity: number,
    strokeType: StrokeType,
    strokeColor: string,
    rawPts: THREE.Vector3[],
    pressuresArr: number[],
    normalsArr: THREE.Vector3[],
    smoothFreehand = true
): void {
    if (rawPts.length < 2) return

    const geometry = mesh.geometry

    let pts = rawPts
    let pressures = pressuresArr
    let finalNormals = normalsArr

    if (shapeType === 'free_hand' && smoothFreehand) {
        pts = smoothPoints(rawPts, smoothPercentage)
        pressures = smoothArray(pressuresArr, smoothPercentage)
        const filteredResult = filterPoints(
            pts,
            pressures,
            normalsArr,
            optimizationThreshold
        )
        pts = filteredResult.filteredPts
        pressures = filteredResult.filteredPressures
        finalNormals = filteredResult.filteredNormals
    } else if (shapeType === 'straight') {
        const filteredResult = filterPoints(
            pts,
            pressures,
            normalsArr,
            optimizationThreshold
        )
        pts = filteredResult.filteredPts
        pressures = filteredResult.filteredPressures
        finalNormals = filteredResult.filteredNormals
    }

    if (pts.length < 2) return

    const positions: number[] = []
    const meshNormals: number[] = []
    const indices: number[] = []
    const colors: number[] = []

    const baseColor = new THREE.Color(strokeColor)

    const tangents: THREE.Vector3[] = []
    for (let i = 0; i < pts.length - 1; i++) {
        tangents.push(
            new THREE.Vector3().subVectors(pts[i + 1]!, pts[i]!).normalize()
        )
    }

    if (pts.length === 2 && tangents.length === 0) {
        tangents.push(
            new THREE.Vector3().subVectors(pts[1]!, pts[0]!).normalize()
        )
    }

    const firstNormal = finalNormals[0] ?? new THREE.Vector3(0, 1, 0)
    const firstTangent = tangents[0] ?? new THREE.Vector3(1, 0, 0)

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
        const angle = Math.acos(THREE.MathUtils.clamp(prevT.dot(currT), -1, 1))

        if (axis.lengthSq() < 1e-6 || angle === 0) {
            transportedRights.push(transportedRights[i - 1]!.clone())
        } else {
            const q = new THREE.Quaternion().setFromAxisAngle(
                axis.normalize(),
                angle
            )
            transportedRights.push(
                transportedRights[i - 1]!.clone().applyQuaternion(q).normalize()
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

        let taperFactor = 1

        if (strokeType === 'taper') {
            const t = pts.length > 1 ? i / (pts.length - 1) : 0
            const taperAmount = 1.0
            taperFactor = 1 - taperAmount + taperAmount * Math.sin(t * Math.PI)
        }

        const effectivePressure =
            (pressures[i] ?? 1) * (strokeType === 'taper' ? taperFactor : 1)

        const { w, h } = getAdaptiveStrokeWidth(
            strokeType,
            effectivePressure,
            width
        )

        const halfW = w
        const halfH = h

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

        const normal = finalNormals[i] ?? firstNormal
        const baseIdx = positions.length / 3

        for (const v of [tl, tr, br, bl, tl, tr, br, bl]) {
            positions.push(v.x, v.y, v.z)
            meshNormals.push(normal.x, normal.y, normal.z)
            colors.push(baseColor.r, baseColor.g, baseColor.b, strokeOpacity)
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
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4))

    geometry.setIndex(indices)

    geometry.attributes.position!.needsUpdate = true
    geometry.attributes.normal!.needsUpdate = true
    if (geometry.index) geometry.index.needsUpdate = true
    geometry.setDrawRange(0, indices.length)
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
    const list = Array.isArray(material) ? material : [material]
    for (const m of list) {
        const withMap = m as THREE.Material & { map?: THREE.Texture | null }
        withMap.map?.dispose()
        m.dispose()
    }
}

/** Scales stroke width by pen pressure, or returns the base width. */
export const getAdaptiveStrokeWidth = (
    strokeType: StrokeType,
    pressure: number,
    width: number
): StrokeWidth => {
    const half = (pressure * width) / 2

    switch (strokeType) {
        case 'taper':
        case 'cube':
            return { w: half, h: half }
        case 'paint':
            return { w: half, h: 0.01 }
        case 'belt':
            return { w: 0.01, h: half }
    }
}

/** The axes currently switched on, as a list. */
export const getActiveMirrorModes = (mirror: MirrorState): MirrorAxis[] => {
    const mirrorString: MirrorAxis[] = []
    if (mirror.x) mirrorString.push('X')
    if (mirror.y) mirrorString.push('Y')
    if (mirror.z) mirrorString.push('Z')
    return mirrorString
}

export interface MirroredSample {
    mirroredPoint: THREE.Vector3
    mirroredNormal: THREE.Vector3
}

/** Reflects a sample across one axis so mirrored strokes track the original. */
export const getMirroredPoint = (
    cachedWorldMatrixInverseRef: { current: THREE.Matrix4 | null },
    cachedWorldMatrixRef: { current: THREE.Matrix4 | null },
    point: THREE.Vector3,
    normal: THREE.Vector3,
    mirrorAxis: MirrorAxis,
    planeMesh: THREE.Mesh
): MirroredSample => {
    if (!cachedWorldMatrixRef.current || !cachedWorldMatrixInverseRef.current) {
        cachedWorldMatrixRef.current = planeMesh.matrixWorld.clone()
        cachedWorldMatrixInverseRef.current = new THREE.Matrix4()
            .copy(planeMesh.matrixWorld)
            .invert()
    }

    const worldMatrix = cachedWorldMatrixRef.current
    const worldMatrixInverse = cachedWorldMatrixInverseRef.current

    const localPoint = point.clone().applyMatrix4(worldMatrixInverse)
    const localNormal = normal
        .clone()
        .transformDirection(worldMatrixInverse)
        .normalize()

    const mirroredLocalPoint = localPoint.clone()
    const mirroredLocalNormal = localNormal.clone()

    if (mirrorAxis === 'X') {
        mirroredLocalPoint.x *= -1
        mirroredLocalNormal.x *= -1
    } else if (mirrorAxis === 'Y') {
        mirroredLocalPoint.y *= -1
        mirroredLocalNormal.y *= -1
    } else {
        mirroredLocalPoint.z *= -1
        mirroredLocalNormal.z *= -1
    }

    return {
        mirroredPoint: mirroredLocalPoint.applyMatrix4(worldMatrix),
        mirroredNormal: mirroredLocalNormal
            .transformDirection(worldMatrix)
            .normalize(),
    }
}

export interface CirclePoints {
    circlePoints: THREE.Vector3[]
    circleNormals: THREE.Vector3[]
}

/** Circle through the drag, laid flat in the drawing plane. */
export const generateCirclePointsWorld = (
    center: THREE.Vector3,
    normal: THREE.Vector3,
    radius: number,
    segments = 64
): CirclePoints => {
    const circlePoints: THREE.Vector3[] = []
    const circleNormals: THREE.Vector3[] = []

    const globalUp = new THREE.Vector3(0, 1, 0)
    const globalRight = new THREE.Vector3(1, 0, 0)

    const startDirection = new THREE.Vector3()

    if (Math.abs(normal.dot(globalUp)) < 0.99) {
        startDirection
            .copy(globalUp)
            .addScaledVector(normal, -globalUp.dot(normal))
            .normalize()
    } else {
        startDirection
            .copy(globalRight)
            .addScaledVector(normal, -globalRight.dot(normal))
            .normalize()
    }

    const perpDirection = new THREE.Vector3()
        .crossVectors(normal, startDirection)
        .normalize()

    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2

        circlePoints.push(
            new THREE.Vector3()
                .copy(center)
                .addScaledVector(startDirection, radius * Math.cos(angle))
                .addScaledVector(perpDirection, radius * Math.sin(angle))
        )
        circleNormals.push(normal.clone())
    }

    return { circlePoints, circleNormals }
}

export interface ArcPoints {
    arcPoints: THREE.Vector3[]
    arcNormals: THREE.Vector3[]
}

/** Open arc through the drag, laid flat in the drawing plane. */
export const generateSemiCircleOpenArcWorld = (
    center: THREE.Vector3,
    normal: THREE.Vector3,
    radius: number,
    segments = 64
): ArcPoints => {
    const arcPoints: THREE.Vector3[] = []
    const arcNormals: THREE.Vector3[] = []

    const tempVector = new THREE.Vector3()
    const tempQuaternion = new THREE.Quaternion()

    const zAxis = new THREE.Vector3(0, 0, 1)
    tempQuaternion.setFromUnitVectors(zAxis, normal)

    for (let i = 0; i <= segments; i++) {
        const angle = Math.PI + (i / segments) * Math.PI
        tempVector.set(radius * Math.cos(angle), radius * Math.sin(angle), 0)
        tempVector.applyQuaternion(tempQuaternion).add(center)
        arcPoints.push(tempVector.clone())
        arcNormals.push(normal.clone())
    }

    return { arcPoints, arcNormals }
}

/** Pulls a curve towards the straight line between its ends. */
export const applyTensionToPoints = (
    points: THREE.Vector3[],
    tensionValue: number
): THREE.Vector3[] => {
    if (points.length < 2) return points

    const tensionedPoints: THREE.Vector3[] = []
    const start = points[0]!
    const end = points[points.length - 1]!

    tensionedPoints.push(start.clone())

    for (let i = 1; i < points.length - 1; i++) {
        const t = i / (points.length - 1)
        const straightPoint = new THREE.Vector3().lerpVectors(start, end, t)
        tensionedPoints.push(
            new THREE.Vector3().lerpVectors(
                points[i]!,
                straightPoint,
                tensionValue
            )
        )
    }

    tensionedPoints.push(end.clone())

    return tensionedPoints
}

const MAX_SMOOTH_WINDOW = 10

function smoothWindow(length: number, percentage: number): number {
    if (!Number.isFinite(percentage)) return 1
    const windowSize = Math.ceil((percentage / 100) * MAX_SMOOTH_WINDOW)
    return Math.max(1, Math.min(windowSize, Math.floor((length - 1) / 2)))
}

/** Moving average over positions, to take hand jitter out of a stroke. */
export const smoothPoints = (
    points: THREE.Vector3[],
    percentage: number
): THREE.Vector3[] => {
    if (percentage === 0 || points.length < 3) return points

    const actualWindowSize = smoothWindow(points.length, percentage)

    const smoothed: THREE.Vector3[] = []
    for (let i = 0; i < points.length; i++) {
        const sum = new THREE.Vector3()
        let count = 0

        for (let j = -actualWindowSize; j <= actualWindowSize; j++) {
            const point = points[i + j]
            if (point) {
                sum.add(point)
                count++
            }
        }

        smoothed.push(sum.divideScalar(count))
    }

    return smoothed
}

/** Moving average over scalars, used for the pressure track. */
export const smoothArray = (arr: number[], percentage: number): number[] => {
    if (percentage === 0 || arr.length < 3) return arr

    const actualWindowSize = smoothWindow(arr.length, percentage)
    const smoothed: number[] = []

    for (let i = 0; i < arr.length; i++) {
        let sum = 0
        let count = 0

        for (let j = -actualWindowSize; j <= actualWindowSize; j++) {
            const value = arr[i + j]
            if (value !== undefined) {
                sum += value
                count++
            }
        }

        smoothed.push(sum / count)
    }

    return smoothed
}

export interface FilteredStroke {
    filteredPts: THREE.Vector3[]
    filteredPressures: number[]
    filteredNormals: THREE.Vector3[]
}

/** Drops samples closer together than the threshold, keeping the ends. */
export const filterPoints = (
    pts: THREE.Vector3[],
    pressures: number[],
    normals: THREE.Vector3[],
    tolerance: number
): FilteredStroke => {
    if (pts.length < 2) {
        return {
            filteredPts: pts,
            filteredPressures: pressures,
            filteredNormals: normals,
        }
    }

    const fallbackNormal = new THREE.Vector3(0, 1, 0)

    const filteredPts: THREE.Vector3[] = [pts[0]!]
    const filteredPressures: number[] = [pressures[0] ?? 1]
    const filteredNormals: THREE.Vector3[] = [normals[0] ?? fallbackNormal]

    let lastKeptIndex = 0

    for (let i = 1; i < pts.length; i++) {
        if (pts[i]!.distanceTo(pts[lastKeptIndex]!) >= tolerance) {
            filteredPts.push(pts[i]!)
            filteredPressures.push(pressures[i] ?? 1)
            filteredNormals.push(normals[i] ?? fallbackNormal)
            lastKeptIndex = i
        }
    }

    if (lastKeptIndex !== pts.length - 1) {
        filteredPts.push(pts[pts.length - 1]!)
        filteredPressures.push(pressures[pressures.length - 1] ?? 1)
        filteredNormals.push(normals[normals.length - 1] ?? fallbackNormal)
    }

    return { filteredPts, filteredPressures, filteredNormals }
}

/** The mesh a stroke starts as, before any geometry is built. */
export function createInitialLineMesh(
    strokeColor: string,
    strokeOpacity: number,
    activeMaterialType: MaterialType,
    maxPoints: number,
    mirror: boolean,
    stripId: StripId
): THREE.Mesh {
    const maxVertices = maxPoints * 4

    const positions = new Float32Array(maxVertices * 3)
    const meshNormals = new Float32Array(maxVertices * 3)
    const indices = new Uint32Array(maxPoints * 24)

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(meshNormals, 3))
    geometry.setIndex(new THREE.BufferAttribute(indices, 1))
    geometry.setDrawRange(0, 0)

    const material = getActiveMaterial(
        activeMaterialType,
        strokeOpacity,
        strokeColor
    )

    const mesh = new THREE.Mesh(geometry, material)
    if (mirror && stripId !== 0) {
        mesh.visible = false
    }

    return mesh
}

export interface SnappedLine {
    snappedEnd: THREE.Vector3
}

/** Straight-line tool: snaps the drag to the nearest axis in the plane. */
export function getSnappedLinePointsInPlane({
    startPoint,
    currentPoint,
    normal,
    camera,
    snapAngle = 45,
}: {
    startPoint: THREE.Vector3
    currentPoint: THREE.Vector3
    normal: THREE.Vector3
    camera: THREE.Camera
    snapAngle?: number

    pointDensity?: number
}): SnappedLine {
    const delta = new THREE.Vector3().subVectors(currentPoint, startPoint)
    const length = delta.length()

    const planeZ = normal.clone()

    const tempX = new THREE.Vector3().crossVectors(planeZ, camera.up)

    if (tempX.lengthSq() < 0.0001) {
        tempX
            .set(1, 0, 0)
            .applyQuaternion(
                new THREE.Quaternion().setFromUnitVectors(
                    new THREE.Vector3(0, 0, 1),
                    planeZ
                )
            )
            .normalize()
    }
    const planeX = tempX.normalize()
    const planeY = new THREE.Vector3().crossVectors(planeX, planeZ).normalize()

    const localDeltaX = delta.dot(planeX)
    const localDeltaY = delta.dot(planeY)

    const angleDeg = THREE.MathUtils.radToDeg(
        Math.atan2(localDeltaY, localDeltaX)
    )
    const snappedDeg = Math.round(angleDeg / snapAngle) * snapAngle
    const snappedRad = THREE.MathUtils.degToRad(snappedDeg)

    const snappedDirection = new THREE.Vector3()
        .addScaledVector(planeX, Math.cos(snappedRad))
        .addScaledVector(planeY, Math.sin(snappedRad))
        .normalize()

    return {
        snappedEnd: startPoint
            .clone()
            .addScaledVector(snappedDirection, length),
    }
}

/** Maps the chosen material type to a three.js material. */
export function getActiveMaterial(
    activeMaterialType: MaterialType,
    strokeOpacity: number,
    strokeColor: string
): StrokeMaterial {
    const baseColor = new THREE.Color(strokeColor)

    const common = {
        color: baseColor,
        wireframe: false,
        transparent: strokeOpacity < 1,
        side: THREE.DoubleSide,
        forceSinglePass: true,
        depthTest: true,
        depthWrite: true,
        opacity: strokeOpacity,
        blending: THREE.NormalBlending,
    } as const

    switch (activeMaterialType) {
        case 'flat':
            return new THREE.MeshBasicMaterial(common)
        case 'shaded':
            return new THREE.MeshStandardMaterial(common)
        case 'glow':
            return new THREE.MeshStandardMaterial({
                ...common,
                emissive: new THREE.Color(strokeColor),
                emissiveIntensity: 1,
            })
    }
}
