import type * as THREE from 'three'

export type StrokeType = 'cube' | 'taper' | 'paint' | 'belt'

export type DrawShapeType = 'free_hand' | 'straight' | 'circle' | 'arc'

export type MaterialType = 'flat' | 'shaded' | 'glow'

export type TransformMode = 'translate' | 'rotate' | 'scale'

export type AxisMode = 'local' | 'world'

export type PointerType = 'mouse' | 'pen' | 'touch'

export type MirrorAxis = 'X' | 'Y' | 'Z'

export interface MirrorState {
    x: boolean
    y: boolean
    z: boolean
}

/** Things the user drew. Persisted. */
export type LineObjectType = 'LINE' | 'MERGED_LINE'

/** Scaffolding. Cleared wholesale and never persisted. */
export type GuideObjectType =
    | 'OG_GUIDE_PLANE'
    | 'BEND_GUIDE_PLANE'
    | 'LOFT_SURFACE'
    | 'DYNAMIC_GUIDE_LINE'

export type SceneObjectType = LineObjectType | GuideObjectType

/*
 * Stored* are the plain-data shapes that survive a structured clone into
 * IndexedDB; the unprefixed ones carry real three.js classes. db/storage.ts
 * converts between them. Mixing the two flattens reloaded strokes.
 */
export interface StoredVec3 {
    x: number
    y: number
    z: number
}

export interface StoredQuat {
    x: number
    y: number
    z: number
    w: number
}

interface LineRecordBase {
    type: LineObjectType
    uuid: string
    group_id: string
    is_deleted: boolean

    is_mirror: boolean

    mirror_mode: MirrorAxis | 'NA'

    color: string
    width: number
    opacity: number
    stroke_type: StrokeType
    shape_type: DrawShapeType
    material_type: MaterialType

    optimization_threshold: number
    smooth_percentage: number

    visible: boolean
}

/*
 * Flat Float32Arrays of xyz triplets, not arrays of objects: a structured
 * clone of a typed array is a memory copy, while cloning tens of thousands of
 * small objects is not, and that cost is paid on every save.
 */
export interface StoredLineRecord extends LineRecordBase {
    points: Float32Array
    normals: Float32Array
    loft_points: Float32Array
    pressures: Float32Array
    position: StoredVec3
    rotation: StoredQuat
    scale: StoredVec3
}

export interface LineRecord extends LineRecordBase {
    points: THREE.Vector3[]
    normals: THREE.Vector3[]
    loft_points: THREE.Vector3[]
    pressures: number[]
    position: THREE.Vector3
    rotation: THREE.Quaternion
    scale: THREE.Vector3
}

interface GroupBase {
    uuid: string
    name: string

    created_at: string
    deleted_at: string | null
    visible: boolean

    active: boolean
}

/**
 * Metadata plus the ids of its lines, in order. Each line lives under its own
 * key, so adding a stroke writes one record rather than the whole document.
 */
export interface StoredGroup extends GroupBase {
    lineIds: string[]
}

export interface Group extends GroupBase {
    objects: LineRecord[]
}

/** A scene mesh whose userData is a full line record. */
export interface LineMesh extends THREE.Mesh {
    userData: LineRecord
}

export interface GuideMesh extends THREE.Mesh {
    userData: { type: GuideObjectType }
}

const LINE_TYPES: readonly string[] = ['LINE', 'MERGED_LINE']

const GUIDE_TYPES: readonly string[] = [
    'OG_GUIDE_PLANE',
    'BEND_GUIDE_PLANE',
    'LOFT_SURFACE',
    'DYNAMIC_GUIDE_LINE',
]

/* Raycasts return bare Object3D. These narrow by the userData tag. */
export function isLineMesh(obj: THREE.Object3D): obj is LineMesh {
    return (
        (obj as THREE.Mesh).isMesh === true &&
        typeof obj.userData.type === 'string' &&
        LINE_TYPES.includes(obj.userData.type)
    )
}

export function isGuideMesh(obj: THREE.Object3D): obj is GuideMesh {
    return (
        (obj as THREE.Mesh).isMesh === true &&
        typeof obj.userData.type === 'string' &&
        GUIDE_TYPES.includes(obj.userData.type)
    )
}

export interface StrokeSample {
    point: THREE.Vector3
    normal: THREE.Vector3
}

export interface StrokeWidth {
    w: number
    h: number
}

export type StripId = 0 | 1 | 2 | 3

export interface MirrorStrokeData {
    points: THREE.Vector3[]
    pressures: number[]
    normals: THREE.Vector3[]
}

export interface GuideStrokeState {
    startPoint: THREE.Vector3 | null
    currentNormal: THREE.Vector3 | null
    isDrawing: boolean
    points: THREE.Vector3[]
    pressures: number[]
    normals: THREE.Vector3[]
    currentMesh: THREE.Mesh | null
}

export function createGuideStroke(): GuideStrokeState {
    return {
        startPoint: null,
        currentNormal: null,
        isDrawing: false,
        points: [],
        pressures: [],
        normals: [],
        currentMesh: null,
    }
}
