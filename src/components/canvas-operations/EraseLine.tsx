import { useRef, useState, useEffect, useCallback, memo } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useShallow } from 'zustand/react/shallow'

import { saveLines, saveSceneMeta } from '../../db/storage'
import { historyBusy, pushHistory } from '../../helpers/historyCapture'
import { findLineRecord } from '../../helpers/records'
import { eraseLineType } from '../../config/objectsConfig'
import { notifySuccess } from '../../helpers/notify'

import { canvasDrawStore } from '../../hooks/useCanvasDrawStore'
import { canvasRenderStore } from '../../hooks/useRenderSceneStore'
import {
    isLineMesh,
    type LineObjectType,
    type LineRecord,
} from '../../types/domain'

function forEachMaterial(
    mesh: THREE.Mesh,
    fn: (material: THREE.Material) => void
): void {
    const material = mesh.material
    if (Array.isArray(material)) {
        material.forEach(fn)
    } else {
        fn(material)
    }
}

/** Raycasts on drag and marks whatever it hits for removal. */
const EraseLine = () => {
    const { camera, pointer, raycaster, scene } = useThree()
    const { activeGroup, setGroupData } = canvasRenderStore(
        useShallow((state) => ({
            activeGroup: state.activeGroup,
            setGroupData: state.setGroupData,
        }))
    )
    const { eraserActive, pointerType } = canvasDrawStore(
        useShallow((state) => ({
            eraserActive: state.eraserActive,
            pointerType: state.pointerType,
        }))
    )

    const highlighted = useRef<Set<THREE.Mesh>>(new Set())
    const [dragging, setDragging] = useState(false)

    // Back to the stroke's own opacity, not to 1: passing over a translucent
    // line without erasing it would otherwise make it fully opaque.
    const resetHighlight = useCallback(() => {
        highlighted.current.forEach((obj) => {
            const opacity = isLineMesh(obj) ? obj.userData.opacity : 1
            forEachMaterial(obj, (material) => {
                material.opacity = opacity
                material.transparent = opacity < 1
                material.needsUpdate = true
            })
        })
        highlighted.current.clear()
    }, [])

    /**
     * Runs once per drag, on pointer-up, so everything the eraser passed over
     * is one history entry rather than one per stroke.
     */
    const eraseObjects = useCallback(async () => {
        if (historyBusy()) return

        // Pointer-up fires on the window, so releasing anywhere with the
        // eraser in hand lands here.
        const totalLines = highlighted.current.size
        if (totalLines === 0) return

        // Only the erased records are written back, not the whole document.
        const erased: LineRecord[] = []

        highlighted.current.forEach((obj) => {
            if (!obj.parent) return
            if (!isLineMesh(obj)) return

            obj.visible = false
            obj.userData.is_deleted = true

            const targetLineData = findLineRecord(
                canvasRenderStore.getState().groupData,
                obj.userData.uuid
            )
            if (targetLineData) {
                targetLineData.is_deleted = true
                erased.push(targetLineData)
            }
        })

        setGroupData([...canvasRenderStore.getState().groupData])

        // Flagged rather than removed, so the strokes can come back. They are
        // dropped from disk on the next load, once the scene rebuild has
        // purged them from the document.
        await saveLines(erased)
        await saveSceneMeta(canvasRenderStore.getState().groupData)

        pushHistory('Erase', [
            {
                kind: 'lines-flagged',
                uuids: erased.map((line) => line.uuid),
                deleted: true,
            },
        ])

        if (totalLines >= 1) {
            notifySuccess(`${totalLines} curves erased!`)
        }

        highlighted.current.clear()
    }, [setGroupData])

    useEffect(() => {
        const onPointerDown = (event: PointerEvent) => {
            if (event.pointerType === pointerType && eraserActive) {
                resetHighlight()
                setDragging(true)
            }
        }

        const onPointerUp = (event: PointerEvent) => {
            if (event.pointerType !== pointerType) return
            if (!eraserActive) return

            setDragging(false)
            void eraseObjects()
        }

        window.addEventListener('pointerdown', onPointerDown)
        window.addEventListener('pointerup', onPointerUp)

        return () => {
            window.removeEventListener('pointerdown', onPointerDown)
            window.removeEventListener('pointerup', onPointerUp)
        }
    }, [resetHighlight, eraseObjects, eraserActive, pointerType])

    useFrame(() => {
        if (!dragging) return

        raycaster.setFromCamera(pointer, camera)

        const activeGroupUuid = activeGroup!.uuid

        const objectsToCheck = scene.children.filter((obj) => {
            if (!isLineMesh(obj)) return false
            return (
                !obj.userData.is_deleted &&
                eraseLineType.includes(obj.userData.type as LineObjectType) &&
                obj.userData.group_id === activeGroupUuid
            )
        })

        const intersects = raycaster.intersectObjects(objectsToCheck, true)
        const first = intersects[0]?.object

        if (first instanceof THREE.Mesh && !highlighted.current.has(first)) {
            highlighted.current.add(first)

            forEachMaterial(first, (material) => {
                material.transparent = true
                material.opacity = 0.5
                material.needsUpdate = true
            })
        }
    })

    return null
}

export default memo(EraseLine)
