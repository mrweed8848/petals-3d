import { useState, memo } from 'react'

import { IconX } from '@tabler/icons-react'
import { useShallow } from 'zustand/react/shallow'

import { saveLines, saveSceneMeta } from '../../db/storage'
import { pushHistory } from '../../helpers/historyCapture'
import { notifyError } from '../../helpers/notify'
import { snapshotGroups } from '../../helpers/records'

import { dashboardStore } from '../../hooks/useDashboardStore'
import { canvasRenderStore } from '../../hooks/useRenderSceneStore'

const CopyGroups = () => {
    const [loading, setLoading] = useState(false)

    const setCopyGroupModal = dashboardStore((state) => state.setCopyGroupModal)

    const {
        copySelectedGroups,
        resetSelectedGroups,
        copyGroups,
        setCopyGroups,
    } = canvasRenderStore(
        useShallow((state) => ({
            copySelectedGroups: state.copySelectedGroups,
            resetSelectedGroups: state.resetSelectedGroups,
            copyGroups: state.copyGroups,
            setCopyGroups: state.setCopyGroups,
        }))
    )

    function handleClose() {
        setCopyGroupModal(false)
    }

    async function handleCopyGroups() {
        try {
            setLoading(true)

            const before = snapshotGroups(
                canvasRenderStore.getState().groupData
            )
            const existing = new Set(before.map((group) => group.uuid))

            copySelectedGroups()

            const updatedGroupData = canvasRenderStore.getState().groupData

            setCopyGroups(!copyGroups)

            /*
             * Only the new groups' lines: a copy holds its own records with
             * fresh ids. Lines first, then the index, which is what the loader
             * trusts, so a crash between the two leaves unreferenced records
             * rather than dangling references.
             */
            const written = await saveLines(
                updatedGroupData
                    .filter((group) => !existing.has(group.uuid))
                    .flatMap((group) => group.objects)
            )
            const response = (await saveSceneMeta(updatedGroupData)) && written

            pushHistory('Duplicate group', [
                {
                    kind: 'groups-changed',
                    before,
                    after: snapshotGroups(updatedGroupData),
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
                    : 'Could not copy groups.'
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
                                <div>Copy selected groups</div>
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
                                    Are you sure you want to copy groups ?
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
                                    onClick={handleCopyGroups}
                                    className="cursor-pointer rounded-[8px] border-[1px] border-accent bg-accent px-[16px] py-[4px] font-semibold text-accent-ink hover:bg-accent/75 disabled:cursor-default disabled:opacity-50"
                                >
                                    Copy
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default memo(CopyGroups)
