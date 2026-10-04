import { useState, type ChangeEvent, memo } from 'react'

import { IconX } from '@tabler/icons-react'
import { useShallow } from 'zustand/react/shallow'

import { saveSceneMeta } from '../../db/storage'
import { pushHistory } from '../../helpers/historyCapture'
import { notifyError } from '../../helpers/notify'
import { snapshotGroups } from '../../helpers/records'

import { dashboardStore } from '../../hooks/useDashboardStore'
import { canvasRenderStore } from '../../hooks/useRenderSceneStore'

const RenameGroups = () => {
    const [loading, setLoading] = useState(false)
    const [groupName, setGroupName] = useState('')

    const setRenameGroupModal = dashboardStore(
        (state) => state.setRenameGroupModal
    )

    const { updateGroupNamesFromSelected, resetSelectedGroups } =
        canvasRenderStore(
            useShallow((state) => ({
                updateGroupNamesFromSelected:
                    state.updateGroupNamesFromSelected,
                resetSelectedGroups: state.resetSelectedGroups,
            }))
        )

    function handleClose() {
        setGroupName('')
        setRenameGroupModal(false)
    }

    function handleNameChange(e: ChangeEvent<HTMLInputElement>) {
        setGroupName(e.target.value)
    }

    async function handleRenameGroup() {
        try {
            setLoading(true)

            const before = snapshotGroups(
                canvasRenderStore.getState().groupData
            )

            updateGroupNamesFromSelected(groupName)

            const updatedGroups = canvasRenderStore.getState().groupData
            // A rename touches no stroke, so only the index is written.
            const response = await saveSceneMeta(updatedGroups)

            pushHistory('Rename group', [
                {
                    kind: 'groups-changed',
                    before,
                    after: snapshotGroups(updatedGroups),
                },
            ])

            if (response) {
                resetSelectedGroups()
            } else {
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
                    : 'Could not rename groups.'
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
                                <div>Rename selected groups</div>
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
                                <div className="mt-[16px]">
                                    <label className="mb-[8px] block text-left font-funnel text-[12px] font-normal text-ink-muted">
                                        Name
                                    </label>
                                    <input
                                        onChange={handleNameChange}
                                        type="text"
                                        className="block w-full rounded-[8px] border-[1px] border-line/25 bg-surface-2 px-[12px] py-[8px] font-funnel text-[12px] font-semibold text-ink focus:border-ink focus:outline-0"
                                        required
                                        disabled={loading}
                                    />
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
                                    onClick={handleRenameGroup}
                                    className="cursor-pointer rounded-[8px] border-[1px] border-accent bg-accent px-[16px] py-[4px] font-semibold text-accent-ink hover:bg-accent/75 disabled:cursor-default disabled:opacity-50"
                                >
                                    Rename
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default memo(RenameGroups)
