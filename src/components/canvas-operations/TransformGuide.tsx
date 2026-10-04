import { useRef, useState, useEffect, useCallback, memo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { useShallow } from 'zustand/react/shallow'

import { historyBusy, pushHistory } from '../../helpers/historyCapture'
import {
    snapshotObjectTransform,
    type ObjectTransformSnapshot,
} from '../../helpers/records'
import { canvasDrawStore } from '../../hooks/useCanvasDrawStore'
import { editorPrefsStore } from '../../hooks/useEditorPrefsStore'
import { transformTargetStore } from '../../hooks/useTransformTargetStore'
import { isGuideMesh } from '../../types/domain'

interface TransformControlsInternals {
    _gizmo: {
        gizmo: {
            translate: THREE.Object3D
        }
    }
}

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

const TransformGuide = () => {
    const { camera, pointer, raycaster, scene, gl, invalidate } = useThree()
    const { axisMode, pointerType, transformMode } = canvasDrawStore(
        useShallow((state) => ({
            axisMode: state.axisMode,
            pointerType: state.pointerType,
            transformMode: state.transformMode,
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

    const [attachedGizmos, setAttachedGizmos] = useState(false)
    const [draggingSelection, setDraggingSelection] = useState(false)

    const tempMatrix = useRef(new THREE.Matrix4())
    const tempPosition = useRef(new THREE.Vector3())
    const tempQuaternion = useRef(new THREE.Quaternion())
    const tempScale = useRef(new THREE.Vector3())

    const hideGizmoPlanes = (helper: THREE.Object3D) => {
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
    }

    const toLocalSpace = (
        object: THREE.Object3D,
        newParent: THREE.Object3D
    ) => {
        object.updateMatrixWorld(true)
        const objectWorldMatrix = object.matrixWorld

        newParent.updateMatrixWorld(true)
        const parentInverseMatrix = tempMatrix.current
            .copy(newParent.matrixWorld)
            .invert()

        const localMatrix = tempMatrix.current.multiplyMatrices(
            parentInverseMatrix,
            objectWorldMatrix
        )

        localMatrix.decompose(
            tempPosition.current,
            tempQuaternion.current,
            tempScale.current
        )

        object.position.copy(tempPosition.current)
        object.rotation.setFromQuaternion(tempQuaternion.current)
        object.scale.copy(tempScale.current)
    }

    const computeCenter = (objects: THREE.Object3D[]): THREE.Vector3 => {
        const box = new THREE.Box3()
        const center = new THREE.Vector3()
        objects.forEach((obj) => {
            obj.updateMatrixWorld(true)
            box.expandByObject(obj)
        })
        return box.getCenter(center)
    }

    const resetHighlight = () => {
        highlighted.current.forEach((obj) => {
            forEachMaterial(obj, (material) => {
                material.transparent = true
                material.opacity = 0.25
            })
        })
        highlighted.current.clear()
    }

    // A guide has no stored record, so both sides are world transforms of the
    // meshes themselves.
    const transformBefore = useRef<ObjectTransformSnapshot[]>([])

    const captureTransformBefore = () => {
        transformBefore.current = dummyTarget.current.children.map(
            snapshotObjectTransform
        )
    }

    const commitTransform = () => {
        const before = transformBefore.current
        transformBefore.current = []
        if (before.length === 0) return

        pushHistory('Transform guide', [
            {
                kind: 'guide-transformed',
                before,
                after: dummyTarget.current.children.map(
                    snapshotObjectTransform
                ),
            },
        ])
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

        const handleDragStart = () => {
            isTransformDragging.current = true
            captureTransformBefore()
        }
        const handleDragEnd = () => {
            isTransformDragging.current = false
            commitTransform()
        }
        const handleDraggingChanged = (e: { value: unknown }) => {
            isTransformDragging.current = Boolean(e.value)
        }

        controls.addEventListener('mouseDown', handleDragStart)
        controls.addEventListener('mouseUp', handleDragEnd)
        controls.addEventListener('dragging-changed', handleDraggingChanged)

        const dummy = dummyTarget.current

        return () => {
            controls.removeEventListener('mouseDown', handleDragStart)
            controls.removeEventListener('mouseUp', handleDragEnd)
            controls.removeEventListener(
                'dragging-changed',
                handleDraggingChanged
            )

            scene.remove(controls.getHelper())
            controls.detach()
            controls.dispose()

            const childrenToRestore = [...dummy.children]
            childrenToRestore.forEach((child) => {
                child.updateMatrixWorld()
                child.applyMatrix4(dummy.matrixWorld)
                if (!scene.children.includes(child)) scene.add(child)
                dummy.remove(child)
            })

            if (scene.children.includes(dummy)) {
                scene.remove(dummy)
            }

            highlighted.current.clear()
        }
    }, [])

    useEffect(() => {
        const controls = transformRef.current
        if (!controls) return
        controls.setMode(transformMode)
        controls.setSpace(axisMode)
        hideGizmoPlanes(controls.getHelper())
    }, [transformMode, axisMode])

    // The legacy gizmo only attaches in legacy mode. Selection and commit are
    // the same either way, which is what lets the joystick drive a guide.
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

    // Publishes the proxy Group for the joystick.
    useEffect(() => {
        if (!attachedGizmos || transformStyle !== 'joystick') {
            setTarget(null)
            return
        }

        setTarget({
            object: dummyTarget.current,
            beginDrag: captureTransformBefore,
            commit: commitTransform,
        })

        return () => setTarget(null)
    }, [attachedGizmos, transformStyle, setTarget])

    // Hands the selection back to the scene so each guide holds its own world
    // transform again. Undo calls this before restoring anything.
    const releaseSelection = useCallback(() => {
        const dummy = dummyTarget.current
        const controls = transformRef.current

        if (controls) {
            controls.detach()
            const helper = controls.getHelper()
            if (scene.children.includes(helper)) scene.remove(helper)
        }

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

    useEffect(() => {
        const onPointerDown = (event: PointerEvent) => {
            // Selecting mid-apply would reparent a mesh an undo is rewriting.
            if (historyBusy()) return
            if (event.pointerType !== pointerType) return

            const target = event.target
            if (
                target instanceof HTMLElement &&
                target.localName === 'canvas' &&
                !isTransformDragging.current &&
                !attachedGizmos
            ) {
                resetHighlight()
                setDraggingSelection(true)
            }
        }

        const onPointerUp = () => {
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

            selectedObjects.forEach((obj) => {
                toLocalSpace(obj, dummyTarget.current)
                dummyTarget.current.add(obj)
                forEachMaterial(obj, (material) => {
                    material.transparent = true
                    material.opacity = 0.25
                })
            })

            invalidate()
            setAttachedGizmos(true)
        }

        window.addEventListener('pointerdown', onPointerDown)
        window.addEventListener('pointerup', onPointerUp)
        return () => {
            window.removeEventListener('pointerdown', onPointerDown)
            window.removeEventListener('pointerup', onPointerUp)
        }
    }, [draggingSelection, attachedGizmos])

    useFrame(() => {
        if (!draggingSelection || attachedGizmos) return

        raycaster.setFromCamera(pointer, camera)

        const objectsToTest = scene.children.filter(isGuideMesh)
        const intersects = raycaster.intersectObjects(objectsToTest, true)

        let hasNewHighlight = false

        intersects.forEach(({ object }) => {
            if (!highlighted.current.has(object)) {
                highlighted.current.add(object)
                forEachMaterial(object, (material) => {
                    material.transparent = true
                    material.opacity = 0.5
                })
                hasNewHighlight = true
            }
        })

        if (hasNewHighlight) invalidate()
    })

    return null
}

export default memo(TransformGuide)
