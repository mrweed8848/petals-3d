import { useRef, useState, useEffect, useMemo, useCallback, memo } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { useShallow } from 'zustand/react/shallow'

import { saveLines, saveSceneMeta } from '../../db/storage'
import {
    cloneLineRecord,
    findLineRecord,
    snapshotTransform,
    type TransformSnapshot,
} from '../../helpers/records'
import { historyBusy, pushHistory } from '../../helpers/historyCapture'
import { notifySuccess } from '../../helpers/notify'
import { canvasDrawStore } from '../../hooks/useCanvasDrawStore'
import { canvasRenderStore } from '../../hooks/useRenderSceneStore'
import { editorPrefsStore } from '../../hooks/useEditorPrefsStore'
import { transformTargetStore } from '../../hooks/useTransformTargetStore'
import { isLineMesh, type LineMesh, type LineRecord } from '../../types/domain'

interface TransformControlsInternals {
    _gizmo: {
        gizmo: {
            translate: THREE.Object3D
        }
    }
}

const SELECTABLE_TYPES: readonly string[] = [
    'LINE',
    'MERGED_LINE',
    'LOFT_SURFACE',
    'BEND_GUIDE_PLANE',
    'OG_GUIDE_PLANE',
]

function forEachMaterial(
    object: THREE.Object3D,
    fn: (material: THREE.Material) => void
): void {
    if (!(object instanceof THREE.Mesh)) return
    const material = object.material as THREE.Material | THREE.Material[]
    if (Array.isArray(material)) {
        material.forEach(fn)
    } else {
        fn(material)
    }
}

/** Gizmo for moving, rotating and scaling selected strokes. */
const TransformLine = () => {
    const { camera, pointer, raycaster, scene, gl, invalidate } = useThree()

    const {
        copy,
        setCopy,
        axisMode,
        lineColor,
        pointerType,
        strokeColor,
        strokeType,
        strokeWidth,
        selectLines,
        drawShapeType,
        strokeOpacity,
        transformMode,
        setSelectLines,
        mergeGeometries,
        setMergeGeometries,
        activeMaterialType,
        strokeStablePercentage,
    } = canvasDrawStore(
        useShallow((state) => ({
            copy: state.copy,
            setCopy: state.setCopy,
            axisMode: state.axisMode,
            lineColor: state.lineColor,
            pointerType: state.pointerType,
            strokeColor: state.strokeColor,
            strokeType: state.strokeType,
            strokeWidth: state.strokeWidth,
            selectLines: state.selectLines,
            drawShapeType: state.drawShapeType,
            strokeOpacity: state.strokeOpacity,
            transformMode: state.transformMode,
            setSelectLines: state.setSelectLines,
            mergeGeometries: state.mergeGeometries,
            setMergeGeometries: state.setMergeGeometries,
            activeMaterialType: state.activeMaterialType,
            strokeStablePercentage: state.strokeStablePercentage,
        }))
    )

    const { activeGroup, setActiveScene, setGroupData } = canvasRenderStore(
        useShallow((state) => ({
            activeGroup: state.activeGroup,
            setActiveScene: state.setActiveScene,
            setGroupData: state.setGroupData,
        }))
    )

    const transformStyle = editorPrefsStore((state) => state.transformStyle)
    const setTarget = transformTargetStore((state) => state.setTarget)
    const setReleaseSelection = transformTargetStore(
        (state) => state.setReleaseSelection
    )

    const transformRef = useRef<TransformControls | null>(null)
    const dummyTarget = useRef(new THREE.Group())
    const selectedCenter = useRef(new THREE.Vector3())
    const isTransformDragging = useRef(false)
    const highlighted = useRef<Set<THREE.Object3D>>(new Set())
    const isCopying = useRef(false)
    const isMerging = useRef(false)

    const [attachedGizmos, setAttachedGizmos] = useState(false)
    const [draggingSelection, setDraggingSelection] = useState(false)

    const tempMatrix = useMemo(() => new THREE.Matrix4(), [])
    const tempPosition = useMemo(() => new THREE.Vector3(), [])
    const tempQuaternion = useMemo(() => new THREE.Quaternion(), [])
    const tempScale = useMemo(() => new THREE.Vector3(), [])

    const toLocalSpace = (
        object: THREE.Object3D,
        newParent: THREE.Object3D
    ) => {
        object.updateMatrixWorld(true)
        const objectWorldMatrix = object.matrixWorld

        newParent.updateMatrixWorld(true)
        const parentInverseMatrix = tempMatrix
            .copy(newParent.matrixWorld)
            .invert()

        const localMatrix = tempMatrix.multiplyMatrices(
            parentInverseMatrix,
            objectWorldMatrix
        )

        localMatrix.decompose(tempPosition, tempQuaternion, tempScale)

        object.position.copy(tempPosition)
        object.rotation.setFromQuaternion(tempQuaternion)
        object.scale.copy(tempScale)
    }

    /** Captured on pointer-down, since the records are rewritten in place. */
    const transformBefore = useRef<TransformSnapshot[]>([])

    const captureTransformBefore = () => {
        transformBefore.current = dummyTarget.current.children
            .filter(isLineMesh)
            .map((mesh) => snapshotTransform(mesh.userData))
    }

    const updateLineWorldPoints = async () => {
        const worldPosition = new THREE.Vector3()
        const worldQuaternion = new THREE.Quaternion()
        const worldScale = new THREE.Vector3()

        // Only the records that actually moved are written back.
        const moved: LineRecord[] = []

        dummyTarget.current.children.forEach((lineObj) => {
            if (!isLineMesh(lineObj)) return
            if (lineObj.userData.type !== 'LINE') return

            lineObj.updateMatrixWorld(true)

            const localPoints = lineObj.userData.loft_points
            if (!localPoints?.length) return

            const worldPoints = localPoints.map((p) =>
                p.clone().applyMatrix4(lineObj.matrixWorld)
            )
            lineObj.userData.loft_points = worldPoints

            lineObj.getWorldPosition(worldPosition)
            lineObj.getWorldQuaternion(worldQuaternion)
            lineObj.getWorldScale(worldScale)

            const targetLineData = findLineRecord(
                canvasRenderStore.getState().groupData,
                lineObj.userData.uuid
            )

            if (targetLineData) {
                targetLineData.position = worldPosition.clone()
                targetLineData.rotation = worldQuaternion.clone()
                targetLineData.scale = worldScale.clone()
                targetLineData.loft_points = worldPoints
                moved.push(targetLineData)
            }
        })

        setGroupData([...canvasRenderStore.getState().groupData])
        await saveLines(moved)

        const before = transformBefore.current
        if (before.length > 0 && moved.length > 0) {
            pushHistory('Transform', [
                {
                    kind: 'lines-transformed',
                    before,
                    after: moved.map(snapshotTransform),
                },
            ])
            transformBefore.current = []
        }
    }

    useEffect(() => {
        const controls = new TransformControls(camera, gl.domElement)
        controls.setSpace(axisMode)
        controls.setMode(transformMode)
        transformRef.current = controls

        controls.setColors('#ff0000', '#00ff00', '#0000ff', '#FF5F1F')

        controls.showX = true
        controls.showY = true
        controls.showZ = true

        const internals = controls as unknown as TransformControlsInternals
        const helper = internals._gizmo.gizmo.translate.children

        helper.forEach((child) => {
            const geometryParams = (
                child as THREE.Mesh & {
                    geometry?: {
                        type?: string
                        paramters?: { radiusTop?: number }
                    }
                }
            ).geometry

            if (
                child.name === 'XY' ||
                child.name === 'XZ' ||
                child.name === 'YZ' ||
                child.name === 'XYZ' ||
                (geometryParams?.type === 'CylinderGeometry' &&
                    geometryParams.paramters?.radiusTop === 0.0075)
            ) {
                child.scale.set(0, 0, 0)
                forEachMaterial(child, (material) => {
                    material.visible = false
                })
                child.visible = false
                child.updateMatrixWorld(true)
            }
        })

        const onDragStart = () => {
            isTransformDragging.current = true
            captureTransformBefore()
        }

        const onDragEnd = () => {
            isTransformDragging.current = false
            void updateLineWorldPoints()
        }

        const onDraggingChanged = (e: { value: unknown }) => {
            isTransformDragging.current = Boolean(e.value)
        }

        controls.addEventListener('mouseDown', onDragStart)
        controls.addEventListener('mouseUp', onDragEnd)
        controls.addEventListener('dragging-changed', onDraggingChanged)

        const dummy = dummyTarget.current

        return () => {
            controls.removeEventListener('mouseDown', onDragStart)
            controls.removeEventListener('mouseUp', onDragEnd)
            controls.removeEventListener('dragging-changed', onDraggingChanged)

            const helperObject = controls.getHelper()
            if (scene.children.includes(helperObject)) {
                scene.remove(helperObject)
            }
            controls.detach()
            controls.dispose()

            const childrenToRestore = [...dummy.children]
            childrenToRestore.forEach((child) => {
                if (!scene.children.includes(child)) {
                    child.updateMatrixWorld(true)
                    child.applyMatrix4(dummy.matrixWorld)
                    dummy.remove(child)
                    scene.add(child)
                }
            })

            if (scene.children.includes(dummy)) {
                scene.remove(dummy)
            }

            highlighted.current.clear()
            gl.info.autoReset = false
            gl.info.reset()
        }
    }, [camera, gl, scene])

    useEffect(() => {
        const controls = transformRef.current
        if (!controls) return

        controls.setMode(transformMode)

        const helper = controls.getHelper()
        const gizmoIndex =
            transformMode === 'translate'
                ? 0
                : transformMode === 'rotate'
                  ? 1
                  : 2

        const gizmo = helper.children[gizmoIndex]
        if (!gizmo) return

        gizmo.children.forEach((child) => {
            if (
                child.name.includes('XY') ||
                child.name.includes('YZ') ||
                child.name.includes('XZ') ||
                child.name.includes('XYZ') ||
                child.name.includes('E')
            ) {
                child.scale.set(0, 0, 0)
                forEachMaterial(child, (material) => {
                    material.visible = false
                })
                child.visible = false
                child.updateMatrixWorld(true)
            }
        })
    }, [transformMode])

    // The legacy gizmo only attaches in legacy mode. Selection, grouping and
    // commit are the same either way, which is what lets the joystick be
    // swapped in without this file knowing about it.
    useEffect(() => {
        const controls = transformRef.current
        if (!controls) return

        const helper = controls.getHelper()

        if (attachedGizmos && transformStyle === 'legacy') {
            controls.attach(dummyTarget.current)
            if (!scene.children.includes(helper)) scene.add(helper)
        } else {
            controls.detach()
            if (scene.children.includes(helper)) scene.remove(helper)
        }
    }, [attachedGizmos, scene, transformStyle])

    // Publishes the proxy Group for the joystick, which lives outside the
    // canvas and cannot reach into the scene graph.
    useEffect(() => {
        if (!attachedGizmos || transformStyle !== 'joystick') {
            setTarget(null)
            return
        }

        setTarget({
            object: dummyTarget.current,
            beginDrag: captureTransformBefore,
            commit: () => void updateLineWorldPoints(),
        })

        return () => setTarget(null)
    }, [attachedGizmos, transformStyle, setTarget])

    useEffect(() => {
        if (transformRef.current) transformRef.current.setMode(transformMode)
    }, [transformMode])

    useEffect(() => {
        if (transformRef.current) transformRef.current.setSpace(axisMode)
    }, [axisMode])

    /**
     * Hands the selection back to the scene: every mesh regains its world
     * transform as its own, the gizmo detaches and the proxy group returns to
     * identity. Undo calls this first, because applying a stored world
     * transform to a still-parented mesh composes the two and scatters
     * the lines.
     */
    const releaseSelection = useCallback(() => {
        const dummy = dummyTarget.current
        const controls = transformRef.current

        if (controls) {
            controls.detach()
            const helper = controls.getHelper()
            if (scene.children.includes(helper)) scene.remove(helper)
        }

        // Must be current before it is folded into each child, or they
        // inherit a stale transform.
        dummy.updateMatrixWorld(true)

        for (const child of [...dummy.children]) {
            child.updateMatrixWorld(true)
            child.applyMatrix4(dummy.matrixWorld)
            dummy.remove(child)
            scene.add(child)
        }

        if (scene.children.includes(dummy)) scene.remove(dummy)

        dummy.position.set(0, 0, 0)
        dummy.quaternion.identity()
        dummy.scale.set(1, 1, 1)
        dummy.updateMatrixWorld(true)

        highlighted.current.clear()
        setAttachedGizmos(false)
        setTarget(null)
    }, [scene, setTarget])

    useEffect(() => {
        setReleaseSelection(releaseSelection)
        return () => setReleaseSelection(null)
    }, [releaseSelection, setReleaseSelection])

    const resetDummyTarget = () => {
        const dummy = dummyTarget.current

        dummy.children.forEach((child) => {
            if (child instanceof THREE.Mesh) {
                child.geometry.dispose()
                forEachMaterial(child, (material) => material.dispose())
            }
            dummy.remove(child)
        })

        if (scene.children.includes(dummy)) scene.remove(dummy)
        dummyTarget.current = new THREE.Group()
    }

    const computeCenter = (objects: THREE.Object3D[]): THREE.Vector3 => {
        const box = new THREE.Box3()
        const center = new THREE.Vector3()

        if (objects.length === 0) return center

        objects.forEach((obj) => {
            obj.updateMatrixWorld(true)
            box.expandByObject(obj)
        })

        return box.getCenter(center)
    }

    useEffect(() => {
        const onPointerDownWindow = (event: PointerEvent) => {
            if (historyBusy()) return
            if (event.pointerType !== pointerType) return

            const target = event.target
            if (
                selectLines &&
                target instanceof HTMLElement &&
                target.localName === 'canvas' &&
                !isTransformDragging.current &&
                !attachedGizmos
            ) {
                setDraggingSelection(true)
            }
        }

        const onPointerUpWindow = () => {
            if (
                !draggingSelection ||
                isTransformDragging.current ||
                attachedGizmos
            ) {
                setDraggingSelection(false)
                return
            }

            setDraggingSelection(false)

            const selectedObjects = Array.from(highlighted.current)
            if (selectedObjects.length === 0) return

            const center = computeCenter(selectedObjects)
            selectedCenter.current.copy(center)
            dummyTarget.current.position.copy(center)

            if (!scene.children.includes(dummyTarget.current)) {
                scene.add(dummyTarget.current)
            }

            selectedObjects.forEach((object) => {
                toLocalSpace(object, dummyTarget.current)
                dummyTarget.current.add(object)

                if (!isLineMesh(object)) return
                const opacity = object.userData.opacity
                forEachMaterial(object, (material) => {
                    material.transparent = opacity < 1
                    material.opacity = opacity
                    material.needsUpdate = true
                })
            })

            invalidate()
            setAttachedGizmos(true)
        }

        window.addEventListener('pointerdown', onPointerDownWindow)
        window.addEventListener('pointerup', onPointerUpWindow)
        return () => {
            window.removeEventListener('pointerdown', onPointerDownWindow)
            window.removeEventListener('pointerup', onPointerUpWindow)
        }
    }, [draggingSelection, attachedGizmos, selectLines])

    useFrame(() => {
        if (!draggingSelection || attachedGizmos) return

        raycaster.setFromCamera(pointer, camera)

        const activeGroupUuid = activeGroup!.uuid

        const objectsToTest = scene.children.filter((obj): obj is LineMesh => {
            if (!(obj instanceof THREE.Mesh)) return false
            const type = obj.userData.type
            return (
                obj.userData.group_id === activeGroupUuid &&
                typeof type === 'string' &&
                SELECTABLE_TYPES.includes(type)
            )
        })

        const intersects = raycaster.intersectObjects(objectsToTest, true)
        let hasNewHighlight = false

        intersects.forEach(({ object }) => {
            if (highlighted.current.has(object)) return

            highlighted.current.add(object)
            hasNewHighlight = true

            forEachMaterial(object, (material) => {
                material.transparent = true
                material.opacity = 0.5
                material.needsUpdate = true
            })
        })

        if (hasNewHighlight) invalidate()
    })

    useEffect(() => {
        if (dummyTarget.current.children.length === 0) return

        const recoloured: LineRecord[] = []
        const previousColours: string[] = []

        dummyTarget.current.children.forEach((obj) => {
            if (!isLineMesh(obj)) return
            if (obj.userData.group_id !== activeGroup?.uuid) return

            const type = obj.userData.type
            if (type !== 'LINE' && type !== 'MERGED_LINE') return

            previousColours.push(obj.userData.color)
            obj.userData.color = lineColor
            recoloured.push(obj.userData)
            forEachMaterial(obj, (material) => {
                if ('color' in material) {
                    ;(material as THREE.MeshBasicMaterial).color.set(lineColor)
                }
                material.needsUpdate = true
            })
        })

        if (highlighted.current.size >= 1) {
            setGroupData([...canvasRenderStore.getState().groupData])
            // A colour change alters no membership, so the index is untouched.
            void saveLines(recoloured)

            pushHistory('Recolour', [
                {
                    kind: 'lines-recoloured',
                    uuids: recoloured.map((line) => line.uuid),
                    before: previousColours,
                    after: lineColor,
                },
            ])
        }

        invalidate()
    }, [lineColor, selectLines, invalidate])

    useEffect(() => {
        if (!copy || isCopying.current) return

        isCopying.current = true
        setAttachedGizmos(false)

        const originalObjects = [...dummyTarget.current.children].map(
            (child) => {
                child.updateMatrixWorld(true)
                child.applyMatrix4(dummyTarget.current.matrixWorld)
                dummyTarget.current.remove(child)
                scene.add(child)
                return child
            }
        )

        if (originalObjects.length === 0) {
            setCopy(false)
            isCopying.current = false
            return
        }

        const clonedRecords: LineRecord[] = []

        const clones = originalObjects.map((original) => {
            const clone = original.clone() as THREE.Mesh

            if (original instanceof THREE.Mesh) {
                clone.geometry = original.geometry.clone()

                const originalMaterial = original.material
                if (Array.isArray(originalMaterial)) {
                    clone.material = originalMaterial.map((mat) => {
                        const clonedMat = mat.clone()
                        clonedMat.needsUpdate = true
                        return clonedMat
                    })
                } else {
                    const clonedMat = originalMaterial.clone()
                    clonedMat.needsUpdate = true
                    clone.material = clonedMat
                }

                const normalAttribute = clone.geometry.attributes.normal
                if (normalAttribute) normalAttribute.needsUpdate = true

                const positionAttribute = clone.geometry.attributes.position
                if (positionAttribute) positionAttribute.needsUpdate = true
            }

            // A deep copy: a spread would share the point arrays, so
            // transforming the copy would rewrite the source stroke.
            clone.userData = cloneLineRecord(original.userData as LineRecord)
            clone.userData.uuid = clone.uuid

            if (isLineMesh(clone)) clonedRecords.push(clone.userData)
            return clone
        })

        const center = computeCenter(clones)
        selectedCenter.current.copy(center)
        dummyTarget.current.position.copy(center)

        clones.forEach((clone) => {
            toLocalSpace(clone, dummyTarget.current)
            dummyTarget.current.add(clone)
        })

        setAttachedGizmos(true)
        setCopy(false)
        isCopying.current = false
        setActiveScene(scene)

        activeGroup?.objects.push(...clonedRecords)

        setGroupData([...canvasRenderStore.getState().groupData])

        // Records first, then the index that references them.
        void saveLines(clonedRecords).then(() =>
            saveSceneMeta(canvasRenderStore.getState().groupData)
        )

        pushHistory('Duplicate', [
            {
                kind: 'lines-added',
                groupId: activeGroup?.uuid ?? '',
                lines: clonedRecords.map(cloneLineRecord),
            },
        ])

        notifySuccess(`${clones.length} curves copied!`)
    }, [copy, scene, selectLines, setCopy, setActiveScene])

    useEffect(() => {
        if (!mergeGeometries || isMerging.current) return

        isMerging.current = true
        setAttachedGizmos(false)

        const objectsToMerge = [...dummyTarget.current.children]

        if (objectsToMerge.length === 0) {
            setMergeGeometries(false)
            isMerging.current = false
            return
        }

        const geometries: THREE.BufferGeometry[] = []
        let allGeometriesValid = true

        for (const mesh of objectsToMerge) {
            mesh.updateMatrixWorld(true)

            if (isLineMesh(mesh) && mesh.userData.type === 'LINE') {
                if (mesh.userData.group_id === activeGroup?.uuid) {
                    ;(
                        mesh.userData as LineRecord & { merged?: boolean }
                    ).merged = true
                }
            }

            if (!(mesh instanceof THREE.Mesh)) {
                allGeometriesValid = false
                continue
            }

            const clonedGeometry = mesh.geometry.clone()
            clonedGeometry.applyMatrix4(mesh.matrixWorld)
            geometries.push(clonedGeometry)

            mesh.parent?.remove(mesh)
            mesh.geometry.dispose()
            forEachMaterial(mesh, (material) => material.dispose())
        }

        if (!allGeometriesValid || geometries.length === 0) {
            resetDummyTarget()
            setMergeGeometries(false)
            isMerging.current = false
            return
        }

        const mergedGeometry = BufferGeometryUtils.mergeGeometries(
            geometries,
            false
        )

        if (!mergedGeometry.attributes.color) {
            const count = mergedGeometry.attributes.position?.count ?? 0
            const colors = new Float32Array(count * 4)

            const strokeColorObj = new THREE.Color(strokeColor)
            for (let i = 0; i < count; i++) {
                colors[i * 4 + 0] = strokeColorObj.r
                colors[i * 4 + 1] = strokeColorObj.g
                colors[i * 4 + 2] = strokeColorObj.b
                colors[i * 4 + 3] = strokeOpacity
            }

            mergedGeometry.setAttribute(
                'color',
                new THREE.BufferAttribute(colors, 4)
            )
        }

        let material: THREE.Material
        switch (activeMaterialType) {
            case 'flat':
                material = new THREE.MeshBasicMaterial({
                    vertexColors: true,
                    wireframe: false,
                    transparent: strokeOpacity < 1,
                    side: THREE.DoubleSide,
                    forceSinglePass: true,
                    depthTest: true,
                    depthWrite: strokeOpacity >= 1,
                    blending: THREE.NormalBlending,
                })
                break

            case 'shaded':
                material = new THREE.MeshStandardMaterial({
                    vertexColors: true,
                    wireframe: false,
                    transparent: strokeOpacity < 1,
                    side: THREE.DoubleSide,
                    forceSinglePass: true,
                    depthTest: true,
                    depthWrite: true,
                    blending: THREE.NoBlending,
                })
                break

            case 'glow':
                material = new THREE.MeshStandardMaterial({
                    vertexColors: true,
                    wireframe: false,
                    transparent: false,
                    side: THREE.DoubleSide,
                    forceSinglePass: true,
                    depthTest: true,
                    depthWrite: true,
                    blending: THREE.NoBlending,
                    emissive: new THREE.Color(strokeColor),
                    emissiveIntensity: 1,
                })
                break
        }

        const combinedMesh = new THREE.Mesh(mergedGeometry, material)
        combinedMesh.geometry.toNonIndexed()
        combinedMesh.geometry.computeVertexNormals()
        combinedMesh.geometry.computeBoundingBox()
        combinedMesh.geometry.computeBoundingSphere()

        const mergedRecord: LineRecord = {
            type: 'MERGED_LINE',
            uuid: combinedMesh.uuid,
            group_id: activeGroup?.uuid ?? '',
            is_deleted: false,
            is_mirror: false,
            mirror_mode: 'NA',
            color: strokeColor,
            width: strokeWidth,
            opacity: strokeOpacity,
            stroke_type: strokeType,
            shape_type: drawShapeType,
            material_type: activeMaterialType,
            optimization_threshold: 0.05,
            smooth_percentage: strokeStablePercentage,
            points: [],
            normals: [],
            loft_points: [],
            pressures: [],
            position: new THREE.Vector3(0, 0, 0),
            rotation: new THREE.Quaternion(0, 0, 0, 1),
            scale: new THREE.Vector3(1, 1, 1),
            visible: combinedMesh.visible,
        }

        combinedMesh.userData = mergedRecord
        scene.add(combinedMesh)

        resetDummyTarget()
        setAttachedGizmos(false)

        setMergeGeometries(false)
        isMerging.current = false
        setActiveScene(scene)
        setSelectLines(!selectLines)
    }, [mergeGeometries, scene, setActiveScene])

    return null
}

export default memo(TransformLine)
