import { memo, useRef, useCallback, type RefObject } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'

import { canvasDrawStore } from '../../hooks/useCanvasDrawStore'
import { themeStore } from '../../hooks/useThemeStore'
import { SCENE } from '../../config/theme'

import {
    createGuideLineMesh,
    generateCirclePointsWorld,
    updateGuideLine,
    intersectPlaneAtPointer,
    getSnappedLinePointsInPlane,
    generateSemiCircleOpenArcWorld,
} from '../../helpers/drawHelper'

import { bendOGGuide } from '../../helpers/bendGuideHelper'
import {
    createGuideStroke,
    type GuideStrokeState,
    type StrokeSample,
} from '../../types/domain'

export interface DynamicBendGuidePlaneProps {
    onDrawingFinished: (mesh: THREE.Mesh) => void
}

function SyncCameraFromMain({
    planeRef,
}: {
    planeRef: RefObject<THREE.Mesh | null>
}) {
    const { camera: mainCamera } = useThree()
    useFrame(() => {
        const plane = planeRef.current
        if (!plane) return
        plane.rotation.copy(mainCamera.rotation)
    })
    return null
}

/** Draws the rail that an existing guide profile is swept along to bend it. */
const DynamicBendGuidePlane = ({
    onDrawingFinished,
}: DynamicBendGuidePlaneProps) => {
    const { camera, scene, gl } = useThree()
    const planeRef = useRef<THREE.Mesh>(null)

    const {
        drawShapeType,
        strokeOpacity,
        ogGuidePoints,
        ogGuideNormals,
        bendPlaneGuide,
        pointerType,
    } = canvasDrawStore(
        useShallow((state) => ({
            drawShapeType: state.drawShapeType,
            strokeOpacity: state.strokeOpacity,
            ogGuidePoints: state.ogGuidePoints,
            ogGuideNormals: state.ogGuideNormals,
            bendPlaneGuide: state.bendPlaneGuide,
            pointerType: state.pointerType,
        }))
    )

    const MAX_POINTS = 50000
    const SMOOTH_PERCENTAGE = 75
    const DISTANCE_THRESHOLD = 0.01
    const OPTIMIZATION_THRESHOLD = 0.01

    const strokeRef = useRef<GuideStrokeState>(createGuideStroke())

    const attachPlane = useCallback(
        (node: THREE.Mesh | null) => {
            planeRef.current = node
            if (node) return

            const stroke = strokeRef.current
            if (stroke.currentMesh) {
                scene.remove(stroke.currentMesh)
                stroke.currentMesh.geometry.dispose()
                const material = stroke.currentMesh.material
                if (!Array.isArray(material)) material.dispose()
            }
            strokeRef.current = createGuideStroke()
        },
        [scene]
    )

    const resolved = themeStore((state) => state.resolved)
    const color = new THREE.Color(SCENE[resolved].guide)

    const BEND_OPTIONS = {
        minPathSamples: 16,
        maxPathSamples: 128,
        minProfileSegments: 8,
        maxProfileSegments: 32,
    } as const

    function createInitialLineMesh(): THREE.Mesh {
        return createGuideLineMesh(scene, color, MAX_POINTS)
    }

    function updateLine(
        mesh: THREE.Mesh,
        rawPts: THREE.Vector3[],
        pressuresArr: number[],
        normalsArr: THREE.Vector3[]
    ): void {
        updateGuideLine(mesh, rawPts, pressuresArr, normalsArr, {
            shapeType: drawShapeType,
            smoothPercentage: SMOOTH_PERCENTAGE,
            optimizationThreshold: OPTIMIZATION_THRESHOLD,
            color,
            opacity: strokeOpacity,
        })
    }

    const getPlaneIntersection = useCallback(
        (event: PointerEvent): StrokeSample | null => {
            const plane = planeRef.current
            if (!plane) return null
            return intersectPlaneAtPointer(event, gl.domElement, camera, plane)
        },
        [camera, gl]
    )

    function startDrawing(event: PointerEvent): void {
        const stroke = strokeRef.current
        if (event.pointerType !== pointerType) return
        if (!planeRef.current) return

        stroke.isDrawing = true
        stroke.points = []
        stroke.pressures = []
        stroke.normals = []

        const intersection = getPlaneIntersection(event)
        if (!intersection) return

        stroke.startPoint = intersection.point.clone()
        stroke.currentNormal = intersection.normal.clone()
        stroke.currentMesh = createInitialLineMesh()

        const pressure = 1.0

        stroke.points.push(stroke.startPoint.clone())
        stroke.pressures.push(pressure)
        stroke.normals.push(stroke.currentNormal)

        if (drawShapeType === 'free_hand') {
            const secondPoint = new THREE.Vector3()
                .copy(stroke.startPoint)
                .addScalar(0.001)
            stroke.points.push(secondPoint)
            stroke.pressures.push(pressure)
            stroke.normals.push(stroke.currentNormal)
        }

        updateLine(
            stroke.currentMesh,
            stroke.points,
            stroke.pressures,
            stroke.normals
        )
    }

    function continueDrawing(event: PointerEvent): void {
        const stroke = strokeRef.current
        if (event.pointerType !== pointerType) return
        if (!stroke.isDrawing || !planeRef.current || !stroke.currentMesh)
            return

        const intersection = getPlaneIntersection(event)
        if (!intersection) return

        const { point, normal } = intersection
        const pressure = 1.0

        if (drawShapeType === 'free_hand') {
            const newPoint = point.clone()
            const last = stroke.points[stroke.points.length - 1]
            if (last && newPoint.distanceTo(last) < DISTANCE_THRESHOLD) return

            stroke.points.push(newPoint)
            stroke.pressures.push(pressure)
            stroke.normals.push(normal)

            if (stroke.points.length > MAX_POINTS) {
                stroke.points.shift()
                stroke.pressures.shift()
                stroke.normals.shift()
            }

            updateLine(
                stroke.currentMesh,
                stroke.points,
                stroke.pressures,
                stroke.normals
            )
        } else if (drawShapeType === 'straight') {
            if (!stroke.startPoint || !stroke.currentNormal) return

            const { snappedEnd } = getSnappedLinePointsInPlane({
                startPoint: stroke.startPoint,
                currentPoint: point,
                normal,
                camera,
                snapAngle: 1,
                pointDensity: 0.05,
            })

            stroke.points = [stroke.startPoint.clone(), snappedEnd.clone()]
            stroke.pressures = [pressure, pressure]
            stroke.normals = [stroke.currentNormal.clone(), normal.clone()]

            updateLine(
                stroke.currentMesh,
                stroke.points,
                stroke.pressures,
                stroke.normals
            )
        } else if (drawShapeType === 'circle') {
            if (!stroke.startPoint || !stroke.currentNormal) return

            const radius = stroke.startPoint.distanceTo(point)
            const { circlePoints, circleNormals } = generateCirclePointsWorld(
                stroke.startPoint,
                stroke.currentNormal,
                radius
            )

            updateLine(
                stroke.currentMesh,
                circlePoints,
                Array(circlePoints.length).fill(pressure),
                circleNormals
            )
        } else if (drawShapeType === 'arc') {
            if (!stroke.startPoint || !stroke.currentNormal) return

            const radius = stroke.startPoint.distanceTo(point)
            const { arcPoints, arcNormals } = generateSemiCircleOpenArcWorld(
                stroke.startPoint,
                stroke.currentNormal,
                radius
            )

            updateLine(
                stroke.currentMesh,
                arcPoints,
                Array(arcPoints.length).fill(pressure),
                arcNormals
            )
        }
    }

    function publishRibbon(wrappedRibbon: THREE.BufferGeometry): void {
        const stroke = strokeRef.current
        const ribbonMaterial = new THREE.MeshBasicMaterial({
            color: color,
            wireframe: false,
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide,
            forceSinglePass: true,
            depthTest: true,
            depthWrite: true,
        })

        const ribbonMesh = new THREE.Mesh(wrappedRibbon, ribbonMaterial)
        ribbonMesh.userData.type = 'BEND_GUIDE_PLANE'
        scene.add(ribbonMesh)

        if (stroke.currentMesh) {
            scene.remove(stroke.currentMesh)
            stroke.currentMesh.geometry.dispose()
            const material = stroke.currentMesh.material
            if (!Array.isArray(material)) material.dispose()
        }

        onDrawingFinished(ribbonMesh)
    }

    function stopDrawing(event: PointerEvent): void {
        const stroke = strokeRef.current
        if (!stroke.isDrawing || !planeRef.current) return

        if (drawShapeType === 'free_hand' || drawShapeType === 'straight') {
            if (
                !stroke.currentMesh ||
                !stroke.startPoint ||
                stroke.points.length < 2
            ) {
                if (stroke.currentMesh) scene.remove(stroke.currentMesh)
                stroke.currentMesh = null
                stroke.startPoint = null
                return
            }

            const wrappedRibbon = bendOGGuide(ogGuidePoints, stroke.points, 1, {
                ...BEND_OPTIONS,
                closedPath: false,
                guidePointNormals: ogGuideNormals,
                guidePathPointNormals: stroke.normals,
            })

            if (wrappedRibbon) publishRibbon(wrappedRibbon)
        } else if (drawShapeType === 'circle') {
            if (
                !stroke.startPoint ||
                !stroke.currentNormal ||
                !stroke.currentMesh
            )
                return

            const lastPoint =
                getPlaneIntersection(event)?.point ??
                stroke.points[stroke.points.length - 1] ??
                stroke.startPoint
            const radius = stroke.startPoint.distanceTo(lastPoint)

            const { circlePoints, circleNormals } = generateCirclePointsWorld(
                stroke.startPoint,
                stroke.currentNormal,
                radius
            )

            updateLine(
                stroke.currentMesh,
                circlePoints,
                Array(circlePoints.length).fill(stroke.pressures[0] ?? 1.0),
                circleNormals
            )

            const wrappedRibbon = bendOGGuide(ogGuidePoints, circlePoints, 1, {
                ...BEND_OPTIONS,
                closedPath: true,
                guidePointNormals: ogGuideNormals,
                guidePathPointNormals: circleNormals,
            })

            if (wrappedRibbon) publishRibbon(wrappedRibbon)
        } else if (drawShapeType === 'arc') {
            if (
                !stroke.startPoint ||
                !stroke.currentNormal ||
                !stroke.currentMesh
            )
                return

            const lastPoint =
                getPlaneIntersection(event)?.point ??
                stroke.points[stroke.points.length - 1] ??
                stroke.startPoint
            const radius = stroke.startPoint.distanceTo(lastPoint)

            const { arcPoints, arcNormals } = generateSemiCircleOpenArcWorld(
                stroke.startPoint,
                stroke.currentNormal,
                radius
            )

            updateLine(
                stroke.currentMesh,
                arcPoints,
                Array(arcPoints.length).fill(stroke.pressures[0] ?? 1.0),
                arcNormals
            )

            const wrappedRibbon = bendOGGuide(ogGuidePoints, arcPoints, 1, {
                ...BEND_OPTIONS,
                closedPath: false,
                guidePointNormals: ogGuideNormals,
                guidePathPointNormals: arcNormals,
            })

            if (wrappedRibbon) publishRibbon(wrappedRibbon)
        }

        stroke.currentMesh = null
        stroke.startPoint = null
        stroke.currentNormal = null
        stroke.isDrawing = false
    }

    return (
        <>
            {ogGuidePoints && bendPlaneGuide && (
                <SyncCameraFromMain planeRef={planeRef} />
            )}
            {ogGuidePoints && bendPlaneGuide && (
                <mesh
                    ref={attachPlane}
                    position={[0, 0, 0]}
                    rotation={[0, 0, 0]}
                    onPointerDown={(e) => startDrawing(e.nativeEvent)}
                    onPointerMove={(e) => continueDrawing(e.nativeEvent)}
                    onPointerUp={(e) => stopDrawing(e.nativeEvent)}
                >
                    <planeGeometry args={[4000, 4000]} />
                    <meshBasicMaterial
                        visible={false}
                        color="#f0f0f0"
                        transparent
                        opacity={0}
                        side={THREE.DoubleSide}
                    />
                </mesh>
            )}
        </>
    )
}

export default memo(DynamicBendGuidePlane)
