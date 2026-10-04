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
import {
    createGuideStroke,
    type GuideStrokeState,
    type StrokeSample,
} from '../../types/domain'

export interface DynamicGuidePlaneProps {
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

/**
 * The core mechanic. An invisible plane is held facing the camera; the curve
 * you draw on it is extruded into a ribbon, and that ribbon becomes the
 * surface the next strokes are drawn onto.
 */
const DynamicGuidePlane = ({ onDrawingFinished }: DynamicGuidePlaneProps) => {
    const { camera, scene, gl } = useThree()
    const planeRef = useRef<THREE.Mesh>(null)

    const {
        drawGuide,
        drawShapeType,
        strokeOpacity,
        setOgGuidePoints,
        setOgGuideNormals,
        pointerType,
    } = canvasDrawStore(
        useShallow((state) => ({
            drawGuide: state.drawGuide,
            drawShapeType: state.drawShapeType,
            strokeOpacity: state.strokeOpacity,
            setOgGuidePoints: state.setOgGuidePoints,
            setOgGuideNormals: state.setOgGuideNormals,
            pointerType: state.pointerType,
        }))
    )

    const MAX_POINTS = 50000
    const SMOOTH_PERCENTAGE = 75
    const DISTANCE_THRESHOLD = 0.01
    const OPTIMIZATION_THRESHOLD = 0.01
    const PLANE_WIDTH = 100

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

    function createContinuousRibbonGeometry(
        ribbonPoints: THREE.Vector3[],
        width: number,
        normal: THREE.Vector3
    ): THREE.BufferGeometry | null {
        if (ribbonPoints.length < 2) return null

        const positions: number[] = []
        const indices: number[] = []
        const uvs: number[] = []

        const sideVector = new THREE.Vector3()
        const halfWidth = width / 2

        for (let i = 0; i < ribbonPoints.length; i++) {
            const p = ribbonPoints[i]!
            let currentDirection: THREE.Vector3

            if (i === 0) {
                currentDirection = new THREE.Vector3()
                    .subVectors(ribbonPoints[1]!, p)
                    .normalize()
            } else if (i === ribbonPoints.length - 1) {
                currentDirection = new THREE.Vector3()
                    .subVectors(p, ribbonPoints[i - 1]!)
                    .normalize()
            } else {
                const prevDirection = new THREE.Vector3()
                    .subVectors(p, ribbonPoints[i - 1]!)
                    .normalize()
                const nextDirection = new THREE.Vector3()
                    .subVectors(ribbonPoints[i + 1]!, p)
                    .normalize()
                currentDirection = prevDirection.add(nextDirection).normalize()
            }

            sideVector.copy(normal)

            if (sideVector.lengthSq() < 0.0001) {
                const tempX = new THREE.Vector3(1, 0, 0)
                const tempY = new THREE.Vector3(0, 1, 0)
                const testVec = currentDirection
                    .clone()
                    .cross(tempX)
                    .normalize()
                if (testVec.lengthSq() < 0.0001) {
                    sideVector.crossVectors(currentDirection, tempY).normalize()
                } else {
                    sideVector.copy(testVec)
                }
            }

            const p1 = new THREE.Vector3()
                .copy(p)
                .addScaledVector(sideVector, halfWidth)
            const p2 = new THREE.Vector3()
                .copy(p)
                .addScaledVector(sideVector, -halfWidth)

            positions.push(p1.x, p1.y, p1.z)
            positions.push(p2.x, p2.y, p2.z)

            const uvX = i / (ribbonPoints.length - 1)
            uvs.push(uvX, 1)
            uvs.push(uvX, 0)

            if (i > 0) {
                const prevIndex = (i - 1) * 2
                const currentIndex = i * 2
                indices.push(prevIndex, prevIndex + 1, currentIndex)
                indices.push(prevIndex + 1, currentIndex + 1, currentIndex)
            }
        }

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(positions, 3)
        )
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
        geometry.setIndex(indices)
        geometry.computeVertexNormals()

        return geometry
    }

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

    function finishRibbon(
        ribbonPoints: THREE.Vector3[],
        ribbonNormals: THREE.Vector3[],
        planeNormal: THREE.Vector3
    ): void {
        const stroke = strokeRef.current
        setOgGuidePoints(ribbonPoints)
        setOgGuideNormals(ribbonNormals)

        const ribbonGeometry = createContinuousRibbonGeometry(
            ribbonPoints,
            PLANE_WIDTH,
            planeNormal
        )
        if (!ribbonGeometry) return

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

        const ribbonMesh = new THREE.Mesh(ribbonGeometry, ribbonMaterial)
        // Tagged so the eraser and the type guards can find it later.
        ribbonMesh.userData.type = 'OG_GUIDE_PLANE'
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

        const intersection = getPlaneIntersection(event)

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

            if (intersection) {
                finishRibbon(stroke.points, stroke.normals, intersection.normal)
            }
        } else if (
            (drawShapeType === 'circle' || drawShapeType === 'arc') &&
            stroke.startPoint &&
            stroke.currentNormal &&
            stroke.currentMesh
        ) {
            const lastPoint =
                intersection?.point ??
                stroke.points[stroke.points.length - 1] ??
                stroke.startPoint
            const radius = stroke.startPoint.distanceTo(lastPoint)
            const pressure = stroke.pressures[0] ?? 1.0

            const shape =
                drawShapeType === 'circle'
                    ? generateCirclePointsWorld(
                          stroke.startPoint,
                          stroke.currentNormal,
                          radius
                      )
                    : generateSemiCircleOpenArcWorld(
                          stroke.startPoint,
                          stroke.currentNormal,
                          radius
                      )

            const shapePoints =
                'circlePoints' in shape ? shape.circlePoints : shape.arcPoints
            const shapeNormals =
                'circleNormals' in shape
                    ? shape.circleNormals
                    : shape.arcNormals

            updateLine(
                stroke.currentMesh,
                shapePoints,
                Array(shapePoints.length).fill(pressure),
                shapeNormals
            )

            if (intersection) {
                finishRibbon(shapePoints, shapeNormals, intersection.normal)
            }
        }

        stroke.currentMesh = null
        stroke.startPoint = null
        stroke.currentNormal = null
        stroke.isDrawing = false
    }

    return (
        <>
            {drawGuide && <SyncCameraFromMain planeRef={planeRef} />}
            {drawGuide && (
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

export default memo(DynamicGuidePlane)
