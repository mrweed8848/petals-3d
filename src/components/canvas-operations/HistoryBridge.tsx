import { useEffect, memo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

import { deleteLines, saveLines, saveSceneMeta } from '../../db/storage'
import { buildLineMesh } from '../../helpers/drawHelper'
import {
    applyObjectTransform,
    applyTransform,
    cloneLineRecord,
} from '../../helpers/records'
import {
    applyRenderSnapshot,
    applyToolSnapshot,
} from '../../helpers/historyCapture'
import { canvasRenderStore } from '../../hooks/useRenderSceneStore'
import { transformTargetStore } from '../../hooks/useTransformTargetStore'
import {
    historyStore,
    type HistoryDirection,
} from '../../hooks/useHistoryStore'
import { isLineMesh, type LineRecord } from '../../types/domain'
import type { HistoryPatch } from '../../types/history'

function meshesByUuid(scene: THREE.Scene): Map<string, THREE.Mesh> {
    const found = new Map<string, THREE.Mesh>()
    scene.traverse((child) => {
        if (isLineMesh(child)) found.set(child.userData.uuid, child)
    })
    return found
}

function removeMesh(scene: THREE.Scene, mesh: THREE.Mesh): void {
    scene.remove(mesh)
    mesh.geometry.dispose()
    const material = mesh.material
    if (Array.isArray(material)) material.forEach((m) => m.dispose())
    else material.dispose()
}

// Records are mutated in place, not replaced: a mesh's userData is the record.
async function applyPatch(
    patch: HistoryPatch,
    direction: HistoryDirection,
    scene: THREE.Scene
): Promise<void> {
    const render = canvasRenderStore.getState()
    const groups = render.groupData
    const meshes = meshesByUuid(scene)

    const groupOf = (id: string) => groups.find((group) => group.uuid === id)

    switch (patch.kind) {
        case 'lines-added': {
            const adding = direction === 'redo'
            const group = groupOf(patch.groupId)
            if (!group) return

            if (adding) {
                // Clone: the history still holds these records.
                const restored = patch.lines.map(cloneLineRecord)
                group.objects.push(...restored)
                restored.forEach((line) =>
                    scene.add(buildLineMesh(scene, line))
                )
                await saveLines(restored)
            } else {
                const ids = new Set(patch.lines.map((line) => line.uuid))
                group.objects = group.objects.filter(
                    (line) => !ids.has(line.uuid)
                )
                ids.forEach((id) => {
                    const mesh = meshes.get(id)
                    if (mesh) removeMesh(scene, mesh)
                })
                await deleteLines([...ids])
            }

            await saveSceneMeta(canvasRenderStore.getState().groupData)
            break
        }

        case 'lines-replaced': {
            const group = groupOf(patch.groupId)
            if (!group) return

            const gone = direction === 'undo' ? patch.added : patch.removed
            const back = direction === 'undo' ? patch.removed : patch.added

            const goneIds = new Set(gone.map((line) => line.uuid))
            group.objects = group.objects.filter(
                (line) => !goneIds.has(line.uuid)
            )
            goneIds.forEach((id) => {
                const mesh = meshes.get(id)
                if (mesh) removeMesh(scene, mesh)
            })

            const restored = back.map(cloneLineRecord)
            group.objects.push(...restored)
            restored.forEach((line) => scene.add(buildLineMesh(scene, line)))

            await deleteLines([...goneIds])
            await saveLines(restored)
            await saveSceneMeta(canvasRenderStore.getState().groupData)
            break
        }

        case 'lines-flagged': {
            const deleted =
                direction === 'undo' ? !patch.deleted : patch.deleted
            const touched: LineRecord[] = []

            for (const group of groups) {
                for (const line of group.objects) {
                    if (!patch.uuids.includes(line.uuid)) continue
                    line.is_deleted = deleted
                    touched.push(line)

                    const mesh = meshes.get(line.uuid)
                    if (!mesh) {
                        // "Erase Guide" disposed it. Replay from the samples.
                        if (!deleted) scene.add(buildLineMesh(scene, line))
                        continue
                    }

                    mesh.visible = !deleted

                    // The eraser faded it to 0.5. Restore from the record.
                    const materials = Array.isArray(mesh.material)
                        ? mesh.material
                        : [mesh.material]
                    materials.forEach((material) => {
                        material.opacity = line.opacity
                        material.transparent = line.opacity < 1
                        if ('color' in material) {
                            ;(material as THREE.MeshBasicMaterial).color.set(
                                line.color
                            )
                        }
                        material.needsUpdate = true
                    })
                }
            }

            await saveLines(touched)
            break
        }

        case 'lines-transformed': {
            const wanted = direction === 'undo' ? patch.before : patch.after
            const touched: LineRecord[] = []

            for (const snapshot of wanted) {
                for (const group of groups) {
                    const line = group.objects.find(
                        (item) => item.uuid === snapshot.uuid
                    )
                    if (!line) continue

                    applyTransform(line, snapshot)
                    touched.push(line)

                    const mesh = meshes.get(line.uuid)
                    if (mesh) {
                        mesh.position.copy(line.position)
                        mesh.quaternion.copy(line.rotation)
                        mesh.scale.copy(line.scale)
                        mesh.updateMatrixWorld(true)
                    }
                }
            }

            await saveLines(touched)
            break
        }

        case 'lines-recoloured': {
            const touched: LineRecord[] = []

            patch.uuids.forEach((uuid, index) => {
                const colour =
                    direction === 'undo' ? patch.before[index] : patch.after
                if (colour === undefined) return

                for (const group of groups) {
                    const line = group.objects.find(
                        (item) => item.uuid === uuid
                    )
                    if (!line) continue

                    line.color = colour
                    touched.push(line)

                    const mesh = meshes.get(uuid)
                    if (!mesh) continue
                    const materials = Array.isArray(mesh.material)
                        ? mesh.material
                        : [mesh.material]
                    materials.forEach((material) => {
                        if ('color' in material) {
                            ;(material as THREE.MeshBasicMaterial).color.set(
                                colour
                            )
                        }
                        material.needsUpdate = true
                    })
                }
            })

            await saveLines(touched)
            break
        }

        case 'groups-changed': {
            const wanted = direction === 'undo' ? patch.before : patch.after

            // Replaced wholesale, so a deleted group can come back. Copied, so
            // the store never holds the wrapper the entry holds.
            const restored = wanted.map((group) => ({ ...group }))

            render.setGroupData(restored)
            render.setActiveGroup(
                restored.find((group) => group.active) ?? null
            )

            await saveSceneMeta(restored)
            break
        }

        case 'render-changed': {
            applyRenderSnapshot(
                direction === 'undo' ? patch.before : patch.after
            )
            break
        }

        case 'guide-transformed': {
            // A guide lives only in the scene, so there is nothing to write.
            const wanted = direction === 'undo' ? patch.before : patch.after
            wanted.forEach(applyObjectTransform)
            break
        }

        case 'guide-changed':
            // Guides are not persisted, so only the tool state is restored.
            break
    }
}

// Lives inside the canvas because applying a patch touches the scene graph,
// which the buttons cannot reach.
const HistoryBridge = () => {
    const { scene, invalidate } = useThree()
    const pending = historyStore((state) => state.pending)

    useEffect(() => {
        if (!pending) return

        const run = async () => {
            const taken = historyStore.getState().take()
            if (!taken) {
                historyStore.getState().finish()
                return
            }

            const { entry, direction } = taken

            try {
                // Release first: a stored world transform written onto a mesh
                // still parented to the proxy group composes with it.
                transformTargetStore.getState().releaseSelection?.()

                const ordered =
                    direction === 'undo'
                        ? [...entry.patches].reverse()
                        : entry.patches

                for (const patch of ordered) {
                    await applyPatch(patch, direction, scene)
                }

                applyToolSnapshot(
                    direction === 'undo' ? entry.toolBefore : entry.toolAfter
                )

                canvasRenderStore.setState({
                    groupData: [...canvasRenderStore.getState().groupData],
                })
                invalidate()
            } catch (error) {
                console.error('Failed to apply a history entry', error)
            } finally {
                // Must run on failure too, or the editor stays locked.
                historyStore.getState().finish()
            }
        }

        void run()
    }, [pending, scene, invalidate])

    return null
}

export default memo(HistoryBridge)
