import { useState, memo } from 'react'

import { IconX } from '@tabler/icons-react'
import { useShallow } from 'zustand/react/shallow'

import { saveSceneMeta } from '../../db/storage'
import { pushHistory } from '../../helpers/historyCapture'
import { notifyError } from '../../helpers/notify'
import { snapshotGroups } from '../../helpers/records'

import { dashboardStore } from '../../hooks/useDashboardStore'
import { canvasRenderStore } from '../../hooks/useRenderSceneStore'

const DeleteGroups = () => {
    const [loading, setLoading] = useState(false)

    const setDeleteGroupModal = dashboardStore(
        (state) => state.setDeleteGroupModal
    )

    const { resetSelectedGroups, deleteSelectedGroups, sortGroupsByName } =
        canvasRenderStore(
            useShallow((state) => ({
                resetSelectedGroups: state.resetSelectedGroups,
                deleteSelectedGroups: state.deleteSelectedGroups,
                sortGroupsByName: state.sortGroupsByName,
            }))
        )

    function handleClose() {
        setDeleteGroupModal(false)
    }

    async function handleDeleteGroups() {
        try {
            setLoading(true)

            const before = snapshotGroups(
                canvasRenderStore.getState().groupData
            )

            deleteSelectedGroups()
            sortGroupsByName()

            const updatedGroupData = canvasRenderStore.getState().groupData
            // Only the index. The line records stay on disk until the next
            // load sweeps them, which is what makes undo possible at all.
            const response = await saveSceneMeta(updatedGroupData)

            // The before side still holds the deleted groups with their
            // `objects` arrays, and their meshes were only hidden, so undo
            // brings both back.
            pushHistory('Delete group', [
                {
                    kind: 'groups-changed',
                    before,
                    after: snapshotGroups(updatedGroupData),
                },
            ])

            resetSelectedGroups()

            if (!response) {
                notifyError(
                    'Could not save the group. Your changes are not stored.'
                )
            }
            handleClose()
        } catch (error) {
            console.error(error)
            notifyError(
                error instanceof Error
                    ? error.message
                    : 'Could not delete groups.'
            )
        } finally {
            setLoading(false)
        }
    }

    return (
        <div>
            <div className="relative z-10 font-funnel font-normal text-ink">
                <div className="fixed inset-0 animate-overlay-in bg-overlay/50"></div>

                <div className="fixed inset-0 z-10 overflow-y-auto text-[8px] md:text-[12px]">
                    <div className="flex h-full items-center justify-center text-center">
                        <div className="relative w-[320px] animate-modal-in overflow-hidden rounded-[12px] border-[1px] border-line/25 bg-surface drop-shadow-xl md:w-[420px]">
                            <div className="m-[4px] flex items-center justify-between border-b-[1px] border-line/25 p-[12px] text-left font-funnel text-[12px] font-semibold md:text-[16px]">
                                <div>Delete Groups</div>
                                <button
                                    onClick={handleClose}
                                    className="flex cursor-pointer justify-center rounded-[8px] border-[0px] p-[4px] hover:bg-surface-3"
                                >
                                    <IconX
                                        color="currentColor"
                                        size={16}
                                        stroke={1.5}
                                    />
                                </button>
                            </div>
                            <div className="mx-[20px] mt-[12px]">
                                <div className="mt-[16px] text-left text-[12px] text-ink-muted">
                                    Are you sure you want to delete groups ?
                                </div>
                            </div>
                            <div className="mt-[12px] flex items-center justify-end gap-[12px] px-[16px] py-[12px]">
                                <button
                                    onClick={handleClose}
                                    className="cursor-pointer rounded-[8px] border-[1px] border-line/25 bg-surface px-[16px] py-[4px] text-ink hover:bg-surface-3"
                                >
                                    Cancel
                                </button>

                                <button
                                    disabled={loading}
                                    onClick={handleDeleteGroups}
                                    className="cursor-pointer rounded-[8px] border-[1px] border-danger bg-danger px-[16px] py-[4px] font-semibold text-danger-ink hover:bg-danger/75 disabled:cursor-default disabled:opacity-50"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default memo(DeleteGroups)
