import { memo } from 'react'
import type { ChangeEvent } from 'react'

import {
    IconAdjustments,
    IconBulb,
    IconCheck,
    IconCopy,
    IconCursorText,
    IconEye,
    IconEyeOff,
    IconPlus,
    IconStack2,
    IconTrash,
} from '@tabler/icons-react'
import { useShallow } from 'zustand/react/shallow'

import ColorPicker from '../ColorPicker'
import Divider from '../Divider'
import ToolTip from '../ToolTip'
import Toggle from '../Toggle'
import RangeSlider from '../RangeSlider'

import { saveSceneMeta } from '../../db/storage'
import {
    historyBusy,
    noteRenderChange,
    pushHistory,
} from '../../helpers/historyCapture'
import { snapshotGroups } from '../../helpers/records'
import { dashboardStore } from '../../hooks/useDashboardStore'
import { canvasRenderStore } from '../../hooks/useRenderSceneStore'
import type { Group } from '../../types/domain'

type SceneTab = 'groups' | 'render'
type GroupOperation = 'add' | 'rename' | 'copy' | 'delete'

const TABS = [
    { id: 'groups' as const, label: 'Groups', Icon: IconStack2 },
    { id: 'render' as const, label: 'Render', Icon: IconAdjustments },
]

const GROUP_ACTIONS = [
    { id: 'add' as const, label: 'New group', Icon: IconPlus },
    { id: 'rename' as const, label: 'Rename', Icon: IconCursorText },
    { id: 'copy' as const, label: 'Duplicate', Icon: IconCopy },
    {
        id: 'delete' as const,
        label: 'Delete',
        Icon: IconTrash,
        destructive: true,
    },
]

export interface SceneOptionsPanelProps {
    isSmall: boolean
}

const SceneOptionsPanel = ({ isSmall }: SceneOptionsPanelProps) => {
    const {
        groupOptions,
        setGroupOptions,
        groupData,
        selectedGroups,
        addToSelectedGroup,
        removeFromSelectedGroup,
        renderOptions,
        setRenderOptions,
        postProcess,
        setPostProcess,
        sequentialLoading,
        setSequentialLoading,
        canvasBackgroundColor,
        setCanvasBackgroundColor,
        lightIntensity,
        setLightIntensity,
    } = canvasRenderStore(
        useShallow((state) => ({
            groupOptions: state.groupOptions,
            setGroupOptions: state.setGroupOptions,
            groupData: state.groupData,
            selectedGroups: state.selectedGroups,
            addToSelectedGroup: state.addToSelectedGroup,
            removeFromSelectedGroup: state.removeFromSelectedGroup,
            renderOptions: state.renderOptions,
            setRenderOptions: state.setRenderOptions,
            postProcess: state.postProcess,
            setPostProcess: state.setPostProcess,
            sequentialLoading: state.sequentialLoading,
            setSequentialLoading: state.setSequentialLoading,
            canvasBackgroundColor: state.canvasBackgroundColor,
            setCanvasBackgroundColor: state.setCanvasBackgroundColor,
            lightIntensity: state.lightIntensity,
            setLightIntensity: state.setLightIntensity,
        }))
    )

    const {
        setNewGroupModal,
        setCopyGroupModal,
        setRenameGroupModal,
        setDeleteGroupModal,
    } = dashboardStore(
        useShallow((state) => ({
            setNewGroupModal: state.setNewGroupModal,
            setCopyGroupModal: state.setCopyGroupModal,
            setRenameGroupModal: state.setRenameGroupModal,
            setDeleteGroupModal: state.setDeleteGroupModal,
        }))
    )

    function handleSceneActiveOptions(option: SceneTab) {
        switch (option) {
            case 'groups':
                setRenderOptions(false)
                setGroupOptions(true)
                break
            case 'render':
                setGroupOptions(false)
                setRenderOptions(true)
                break
        }
    }

    function handleSelectGroup(e: ChangeEvent<HTMLInputElement>, data: Group) {
        if (e.target.checked) {
            addToSelectedGroup(data)
        } else {
            removeFromSelectedGroup(data.uuid)
        }
    }

    function handleGroupOperation(operation: GroupOperation) {
        switch (operation) {
            case 'add':
                setNewGroupModal(true)
                break
            case 'rename':
                setRenameGroupModal(true)
                break
            case 'copy':
                setCopyGroupModal(true)
                break
            case 'delete':
                setDeleteGroupModal(true)
                break
        }
    }

    /** Writes the index and records one entry, for any group metadata change. */
    async function commitGroupChange(label: string, change: () => void) {
        if (historyBusy()) return

        const before = snapshotGroups(canvasRenderStore.getState().groupData)
        change()
        const after = canvasRenderStore.getState().groupData

        await saveSceneMeta(after)

        pushHistory(label, [
            { kind: 'groups-changed', before, after: snapshotGroups(after) },
        ])
    }

    async function handleGroupVisibility(data: Group) {
        await commitGroupChange(
            data.visible ? 'Hide group' : 'Show group',
            () =>
                canvasRenderStore
                    .getState()
                    .updateVisibleGroupProduct(data.uuid, !data.visible)
        )
    }

    async function handleActiveGroup(data: Group) {
        await commitGroupChange('Active group', () => {
            const store = canvasRenderStore.getState()
            store.setActiveGroup(data)
            store.updateActiveGroupProduct(data.uuid)
        })
    }

    // Render settings fire onChange on every movement. noteRenderChange opens
    // one burst per interaction, so a whole drag is one history entry.
    function withHistory<T>(label: string, set: (value: T) => void) {
        return (value: T) => {
            noteRenderChange(label)
            set(value)
        }
    }

    const iconSize = isSmall ? 12 : 20
    const activeTab: SceneTab = renderOptions ? 'render' : 'groups'

    return (
        <div className="absolute top-[72px] right-[12px] z-5 flex w-[200px] flex-col gap-[12px] rounded-[12px] border-[1px] border-line/25 bg-surface p-[8px] font-funnel text-[8px] font-normal text-ink drop-shadow-xl md:w-[260px] md:text-[12px]">
            <div className="flex gap-[4px] rounded-[8px] bg-surface-2 p-[2px]">
                {TABS.map((tab) => (
                    <ToolTip
                        key={tab.id}
                        text={tab.label}
                        position="bottom"
                        delay={100}
                        className="flex-1"
                    >
                        <button
                            onClick={() => handleSceneActiveOptions(tab.id)}
                            className={`flex w-full cursor-pointer justify-center rounded-[6px] border-[0px] p-[6px] ${
                                activeTab === tab.id
                                    ? 'bg-accent text-accent-ink'
                                    : 'text-ink-muted hover:bg-surface-3 hover:text-ink'
                            }`}
                        >
                            <tab.Icon
                                color="currentColor"
                                size={iconSize}
                                stroke={1.5}
                            />
                        </button>
                    </ToolTip>
                ))}
            </div>

            {groupOptions && (
                <>
                    <div className="flex justify-center gap-[4px]">
                        {GROUP_ACTIONS.map((action) => (
                            <ToolTip
                                key={action.id}
                                text={action.label}
                                position="bottom"
                                delay={100}
                            >
                                <button
                                    onClick={() =>
                                        handleGroupOperation(action.id)
                                    }
                                    className={`flex cursor-pointer justify-center rounded-[8px] border-[0px] p-[8px] ${
                                        action.destructive
                                            ? 'hover:bg-danger hover:text-danger-ink'
                                            : 'hover:bg-surface-3'
                                    }`}
                                >
                                    <action.Icon
                                        color="currentColor"
                                        size={iconSize}
                                        stroke={1.5}
                                    />
                                </button>
                            </ToolTip>
                        ))}
                    </div>

                    <Divider orientation="horizontal" />

                    {/* `custom-scrollbar` carries no styles. Editor finds it
                        with closest() to exempt this list from the page-wide
                        gesture and scroll suppression. */}
                    <div className="custom-scrollbar flex max-h-[320px] touch-pan-y flex-col gap-[2px] overflow-y-auto overscroll-contain contain-[layout_style_paint] [-webkit-overflow-scrolling:touch]">
                        {groupData.length === 0 && (
                            <div className="px-[8px] py-[12px] text-center text-ink-muted">
                                No groups yet
                            </div>
                        )}

                        {groupData.map((data) => (
                            <div
                                key={data.uuid}
                                className={`flex items-center gap-[8px] rounded-[8px] px-[8px] py-[4px] ${
                                    /* A tint, not a solid fill, which would
                                       swallow the checkbox and eye toggle. */
                                    data.active
                                        ? 'bg-accent/20 font-semibold'
                                        : 'hover:bg-surface-2'
                                }`}
                            >
                                <ToolTip
                                    text="Select"
                                    position="bottom"
                                    delay={100}
                                >
                                    <label className="flex cursor-pointer items-center">
                                        <input
                                            type="checkbox"
                                            className="peer sr-only"
                                            checked={selectedGroups.some(
                                                (group) =>
                                                    group.uuid === data.uuid
                                            )}
                                            onChange={(e) =>
                                                handleSelectGroup(e, data)
                                            }
                                        />

                                        {/* Transparent until checked, or every
                                            group shows a tick. */}
                                        <div className="flex size-[16px] items-center justify-center rounded-full border-[1px] border-line/25 bg-surface text-transparent peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-ink">
                                            <IconCheck
                                                size={12}
                                                color="currentColor"
                                                stroke={2}
                                            />
                                        </div>
                                    </label>
                                </ToolTip>

                                {/* Truncated by layout, not by slicing, so the
                                    full name survives on hover. */}
                                <button
                                    onClick={() => void handleActiveGroup(data)}
                                    title={data.name}
                                    className="min-w-0 flex-1 cursor-pointer truncate border-[0px] bg-transparent p-0 text-left text-inherit"
                                >
                                    {data.name}
                                </button>

                                <ToolTip
                                    text={data.visible ? 'Hide' : 'Show'}
                                    position="left"
                                    delay={100}
                                >
                                    <button
                                        onClick={() =>
                                            void handleGroupVisibility(data)
                                        }
                                        className={`flex cursor-pointer justify-center rounded-[6px] border-[0px] p-[4px] hover:bg-surface-3 ${
                                            data.visible ? '' : 'text-ink-muted'
                                        }`}
                                    >
                                        {data.visible ? (
                                            <IconEye
                                                color="currentColor"
                                                size={iconSize}
                                                stroke={1.5}
                                            />
                                        ) : (
                                            <IconEyeOff
                                                color="currentColor"
                                                size={iconSize}
                                                stroke={1.5}
                                            />
                                        )}
                                    </button>
                                </ToolTip>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {renderOptions && (
                <>
                    <div className="flex items-center gap-[8px]">
                        <ToolTip
                            text="Light Intensity"
                            position="bottom"
                            delay={100}
                        >
                            <IconBulb
                                color="currentColor"
                                size={iconSize}
                                stroke={1.5}
                            />
                        </ToolTip>

                        <div className="min-w-0 flex-1">
                            <RangeSlider
                                name="Light Intensity"
                                max={10}
                                min={0}
                                step={1}
                                value={lightIntensity}
                                setUpdatingValue={withHistory(
                                    'Light intensity',
                                    setLightIntensity
                                )}
                                compact
                            />
                        </div>

                        {/* Fixed width and tabular digits, so the row holds
                            still from one digit to two. */}
                        <div className="w-[20px] shrink-0 text-right font-semibold tabular-nums">
                            {lightIntensity}
                        </div>
                    </div>

                    <Divider orientation="horizontal" />

                    <div className="flex items-center justify-between gap-[12px]">
                        <div>Post Process</div>
                        <Toggle
                            checked={postProcess}
                            onChange={withHistory(
                                'Post process',
                                setPostProcess
                            )}
                            isSmall={isSmall}
                            label="Post Process"
                        />
                    </div>

                    <div className="flex items-center justify-between gap-[12px]">
                        <div>Sequential Loading</div>
                        <Toggle
                            checked={sequentialLoading}
                            onChange={withHistory(
                                'Sequential loading',
                                setSequentialLoading
                            )}
                            isSmall={isSmall}
                            label="Sequential Loading"
                        />
                    </div>

                    <Divider orientation="horizontal" />

                    <div className="gesture-allowed flex flex-col gap-[8px]">
                        <div className="text-ink-muted">Background</div>
                        <ColorPicker
                            value={canvasBackgroundColor}
                            onChange={withHistory(
                                'Background colour',
                                setCanvasBackgroundColor
                            )}
                            isSmall={isSmall}
                        />
                    </div>
                </>
            )}
        </div>
    )
}

export default memo(SceneOptionsPanel)
