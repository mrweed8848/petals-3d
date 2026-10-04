import { create } from 'zustand'
import type * as THREE from 'three'

import type {
    DrawShapeType,
    MaterialType,
    MirrorState,
    PointerType,
    StrokeType,
    TransformMode,
    AxisMode,
} from '../types/domain'

/** Tool state and brush settings. The 3D layer reads almost everything here. */
export interface CanvasDrawState {
    /** Input device the editor is bound to. Every pointer handler gates on it. */
    pointerType: PointerType
    setPointerType: (value: PointerType) => void

    /** The surface strokes are currently drawn onto. */
    plane: THREE.Mesh | null
    setPlane: (p: THREE.Mesh | null) => void

    /** Same mesh as `plane`; kept apart so a guide swap can clear one. */
    dynamicDrawingPlaneMesh: THREE.Mesh | null
    setDynamicDrawingPlaneMesh: (mesh: THREE.Mesh | null) => void

    penActive: boolean
    setPenActive: (active: boolean) => void

    eraserActive: boolean
    setEraserActive: (active: boolean) => void

    selectLines: boolean
    setSelectLines: (select: boolean) => void

    selectGuide: boolean
    setSelectGuide: (select: boolean) => void

    drawGuide: boolean
    setDrawGuide: (draw: boolean) => void

    eraseGuide: boolean
    setEraseGuide: (bool: boolean) => void

    bendPlaneGuide: boolean
    setBendPlaneGuide: (bool: boolean) => void

    loftGuidePlane: boolean
    setLoftGuidePlane: (bool: boolean) => void

    generateLoftSurface: boolean
    setGenerateLoftSurface: (bool: boolean) => void

    copy: boolean
    setCopy: (bool: boolean) => void

    mergeGeometries: boolean
    setMergeGeometries: (bool: boolean) => void

    activeMaterialType: MaterialType
    setActiveMaterialType: (type: MaterialType) => void

    strokeType: StrokeType
    setStrokeType: (style: StrokeType) => void

    drawShapeType: DrawShapeType
    setDrawShapeType: (style: DrawShapeType) => void

    strokeColor: string
    setStrokeColor: (color: string) => void

    strokeWidth: number
    setStrokeWidth: (width: number) => void

    strokeOpacity: number
    setStrokeOpacity: (opacity: number) => void

    /** Moving-average window for jitter reduction, 0..100. */
    strokeStablePercentage: number
    setStrokeStablePercentage: (value: number) => void

    pressureMode: boolean
    setPressureMode: (bool: boolean) => void

    /** Colour applied to an existing selection, distinct from strokeColor. */
    lineColor: string
    setLineColor: (color: string) => void

    mirror: MirrorState
    setMirror: (value: Partial<MirrorState>) => void

    mirrorOptions: boolean
    setMirrorOptions: (bool: boolean) => void

    /** Meshes the selection tool currently has picked. */
    highlighted: THREE.Mesh[]
    setHighlighted: (data: THREE.Mesh[]) => void
    addToHighlighted: (mesh: THREE.Mesh) => void

    transformMode: TransformMode
    setTransformMode: (mode: TransformMode) => void

    axisMode: AxisMode
    setAxisMode: (mode: AxisMode) => void

    /** Profile curve the bend tool sweeps along a rail. */
    ogGuidePoints: THREE.Vector3[] | null
    setOgGuidePoints: (data: THREE.Vector3[] | null) => void

    ogGuideNormals: THREE.Vector3[] | null
    setOgGuideNormals: (data: THREE.Vector3[] | null) => void

    openOpacitySlider: boolean
    setOpenOpacitySlider: (bool: boolean) => void

    openWidthSlider: boolean
    setOpenWidthSlider: (bool: boolean) => void

    openStrokeStabler: boolean
    setOpenStrokeStabler: (bool: boolean) => void

    openDrawShapeOptions: boolean
    setOpenDrawShapeOptions: (bool: boolean) => void

    openColorOptions: boolean
    setOpenColorOptions: (bool: boolean) => void

    openStrokeOptions: boolean
    setOpenStrokeOptions: (bool: boolean) => void

    drawGuideShapeOptions: boolean
    setDrawGuideShapeOptions: (bool: boolean) => void

    tensionPercentage: number
    setTensionPercentage: (value: number) => void

    polyCountPercentage: number
    setPolyCountPercentage: (value: number) => void

    radialPercentage: number
    setRadialPercentage: (value: number) => void

    waistPercentage: number
    setWaistPercentage: (value: number) => void
}

export const canvasDrawStore = create<CanvasDrawState>((set) => ({
    pointerType: 'mouse',
    setPointerType: (value) => set({ pointerType: value }),

    plane: null,
    setPlane: (p) => set({ plane: p }),

    dynamicDrawingPlaneMesh: null,
    setDynamicDrawingPlaneMesh: (mesh) =>
        set({ dynamicDrawingPlaneMesh: mesh }),

    penActive: false,
    setPenActive: (active) => set({ penActive: active }),

    eraserActive: false,
    setEraserActive: (active) => set({ eraserActive: active }),

    selectLines: false,
    setSelectLines: (select) => set({ selectLines: select }),

    selectGuide: false,
    setSelectGuide: (select) => set({ selectGuide: select }),

    drawGuide: false,
    setDrawGuide: (draw) => set({ drawGuide: draw }),

    eraseGuide: false,
    setEraseGuide: (bool) => set({ eraseGuide: bool }),

    bendPlaneGuide: false,
    setBendPlaneGuide: (bool) => set({ bendPlaneGuide: bool }),

    loftGuidePlane: false,
    setLoftGuidePlane: (bool) => set({ loftGuidePlane: bool }),

    generateLoftSurface: false,
    setGenerateLoftSurface: (bool) => set({ generateLoftSurface: bool }),

    copy: false,
    setCopy: (bool) => set({ copy: bool }),

    mergeGeometries: false,
    setMergeGeometries: (bool) => set({ mergeGeometries: bool }),

    activeMaterialType: 'flat',
    setActiveMaterialType: (type) => set({ activeMaterialType: type }),

    strokeType: 'cube',
    setStrokeType: (style) => set({ strokeType: style }),

    drawShapeType: 'free_hand',
    setDrawShapeType: (style) => set({ drawShapeType: style }),

    strokeColor: '#8F8F8F',
    setStrokeColor: (color) => set({ strokeColor: color }),

    strokeWidth: 0.1,
    setStrokeWidth: (width) => set({ strokeWidth: width }),

    strokeOpacity: 1,
    setStrokeOpacity: (opacity) => set({ strokeOpacity: opacity }),

    strokeStablePercentage: 30,
    setStrokeStablePercentage: (value) =>
        set({ strokeStablePercentage: value }),

    pressureMode: false,
    setPressureMode: (bool) => set({ pressureMode: bool }),

    lineColor: '#8F8F8F',
    setLineColor: (color) => set({ lineColor: color }),

    mirror: { x: false, y: false, z: false },
    setMirror: (value) =>
        set((state) => ({ mirror: { ...state.mirror, ...value } })),

    mirrorOptions: false,
    setMirrorOptions: (bool) => set({ mirrorOptions: bool }),

    highlighted: [],
    setHighlighted: (data) =>
        set((state) =>
            state.highlighted.length === 0 && data.length === 0
                ? state
                : { highlighted: data }
        ),
    addToHighlighted: (mesh) =>
        set((state) => ({ highlighted: [...state.highlighted, mesh] })),

    transformMode: 'translate',
    setTransformMode: (mode) => set({ transformMode: mode }),

    axisMode: 'local',
    setAxisMode: (mode) => set({ axisMode: mode }),

    ogGuidePoints: null,
    setOgGuidePoints: (data) => set({ ogGuidePoints: data }),

    ogGuideNormals: null,
    setOgGuideNormals: (data) => set({ ogGuideNormals: data }),

    openOpacitySlider: false,
    setOpenOpacitySlider: (bool) => set({ openOpacitySlider: bool }),

    openWidthSlider: false,
    setOpenWidthSlider: (bool) => set({ openWidthSlider: bool }),

    openStrokeStabler: false,
    setOpenStrokeStabler: (bool) => set({ openStrokeStabler: bool }),

    openDrawShapeOptions: false,
    setOpenDrawShapeOptions: (bool) => set({ openDrawShapeOptions: bool }),

    openColorOptions: false,
    setOpenColorOptions: (bool) => set({ openColorOptions: bool }),

    openStrokeOptions: false,
    setOpenStrokeOptions: (bool) => set({ openStrokeOptions: bool }),

    drawGuideShapeOptions: false,
    setDrawGuideShapeOptions: (bool) => set({ drawGuideShapeOptions: bool }),

    tensionPercentage: 50,
    setTensionPercentage: (value) => set({ tensionPercentage: value }),

    polyCountPercentage: 1,
    setPolyCountPercentage: (value) => set({ polyCountPercentage: value }),

    radialPercentage: 50,
    setRadialPercentage: (value) => set({ radialPercentage: value }),

    waistPercentage: 50,
    setWaistPercentage: (value) => set({ waistPercentage: value }),
}))
