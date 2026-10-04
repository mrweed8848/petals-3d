import { memo, useRef, useCallback, type RefObject } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'

import { canvasDrawStore } from '../../hooks/useCanvasDrawStore'
import { themeStore } from '../../hooks/useThemeStore'
import { SCENE } from '../../config/theme'

import {
    smoothArray,
    smoothPoints,
    filterPoints,
    generateCirclePointsWorld,
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
        const maxVertices = MAX_POINTS * 4

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
            new THREE.BufferAttribute(new Uint32Array(MAX_POINTS * 24), 1)
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

    function updateLine(
        mesh: THREE.Mesh,
        rawPts: THREE.Vector3[],
        pressuresArr: number[],
        normalsArr: THREE.Vector3[]
    ): void {
        if (rawPts.length < 2) return

        const geometry = mesh.geometry

        let pts = rawPts
        let finalNormals = normalsArr

        if (drawShapeType === 'free_hand') {
            pts = smoothPoints(rawPts, SMOOTH_PERCENTAGE)
            const smoothedPressures = smoothArray(
                pressuresArr,
                SMOOTH_PERCENTAGE
            )
            const filteredResult = filterPoints(
                pts,
                smoothedPressures,
                normalsArr,
                OPTIMIZATION_THRESHOLD
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
            material.opacity = strokeOpacity
            material.needsUpdate = true
        }
    }

    const getPlaneIntersection = useCallback(
        (event: PointerEvent): StrokeSample | null => {
            const plane = planeRef.current
            if (!plane) return null

            const canvas = gl.domElement
            const rect = canvas.getBoundingClientRect()

            const mouse = new THREE.Vector2(
                ((event.clientX - rect.left) / rect.width) * 2 - 1,
                -((event.clientY - rect.top) / rect.height) * 2 + 1
            )

            const raycaster = new THREE.Raycaster()
            raycaster.setFromCamera(mouse, camera)

            const intersects = raycaster.intersectObject(plane)
            const intersection = intersects[0]
            if (!intersection?.face) return null

            return {
                point: intersection.point.clone(),
                normal: intersection.face.normal
                    .clone()
                    .transformDirection(intersection.object.matrixWorld)
                    .normalize(),
            }
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
