import { useCallback, useEffect, useRef, useState } from 'react'

import {
    IconBallpen,
    IconBrandGithub,
    IconDeviceDesktop,
    IconDownload,
    IconHandFinger,
    IconMenu2,
    IconMoon,
    IconMouse,
    IconSun,
} from '@tabler/icons-react'
import { v4 as uuidv4 } from 'uuid'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { useShallow } from 'zustand/react/shallow'

import Canvas3d from './Canvas3d'
import ToolPanel from '../tools/ToolPanel'
import ViewsPanel from '../tools/ViewsPanel'

import { dashboardStore } from '../../hooks/useDashboardStore'
import { themeStore } from '../../hooks/useThemeStore'
import { historyStore } from '../../hooks/useHistoryStore'
import { SCENE } from '../../config/theme'
import { canvasDrawStore } from '../../hooks/useCanvasDrawStore'
import { canvasRenderStore } from '../../hooks/useRenderSceneStore'

import CopyGroups from '../groups/CopyGroups'
import AddNewGroups from '../groups/AddNewGroups'
import RenameGroups from '../groups/RenameGroups'
import DeleteGroups from '../groups/DeleteGroups'

import ToolTip from '../ToolTip'
import Joystick from '../joystick/Joystick'
import {
    dismissNotice,
    notifyError,
    notifyInfo,
    POINTER_PROMPT,
} from '../../helpers/notify'
import { loadSceneFromIndexedDB, saveWholeScene } from '../../db/storage'
import type { Group, PointerType } from '../../types/domain'

/*
 * Containers that keep native scrolling and browser gestures. `custom-scrollbar`
 * and `gesture-allowed` carry no styles and exist only as markers for this.
 */
const GESTURE_EXEMPT = '.overflow-y-auto, .custom-scrollbar, .gesture-allowed'

/** Keys that scroll the page, suppressed so they cannot fire mid-stroke. */
const SCROLL_KEYS = [32, 33, 34, 35, 36, 37, 38, 39, 40]

const THEME_OPTIONS = [
    { mode: 'light' as const, label: 'Light', Icon: IconSun },
    { mode: 'dark' as const, label: 'Dark', Icon: IconMoon },
    { mode: 'system' as const, label: 'System', Icon: IconDeviceDesktop },
]

/** True when the event started inside a container that keeps its gestures. */
function isExempt(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false
    if (target.closest(GESTURE_EXEMPT)) return true
    return target.tagName === 'CANVAS'
}

function DisableBrowserGestures() {
    useEffect(() => {
        const preventDefaultTouch = (e: TouchEvent) => {
            if (isExempt(e.target)) return
            if (e.touches.length > 1) e.preventDefault()
        }

        const preventPullToRefresh = (e: TouchEvent) => {
            if (isExempt(e.target)) return
            if (window.scrollY === 0) e.preventDefault()
        }

        const preventDefaultGestures = (e: Event) => {
            if (isExempt(e.target)) return
            e.preventDefault()
        }

        const preventContextMenu = (e: MouseEvent) => {
            if (isExempt(e.target)) return
            e.preventDefault()
        }

        let lastTouchEnd = 0
        const preventDoubleTapZoom = (e: TouchEvent) => {
            if (isExempt(e.target)) return
            const now = Date.now()
            if (now - lastTouchEnd <= 300) e.preventDefault()
            lastTouchEnd = now
        }

        const preventScroll = (e: Event) => {
            if (isExempt(e.target)) return
            e.preventDefault()
            e.stopPropagation()
        }

        const preventWheel = (e: Event) => {
            if (isExempt(e.target)) return
            e.preventDefault()
        }

        const preventKeyboardScroll = (e: KeyboardEvent) => {
            if (
                e.target instanceof Element &&
                e.target.closest(GESTURE_EXEMPT)
            ) {
                return
            }
            if (SCROLL_KEYS.includes(e.keyCode)) e.preventDefault()
        }

        const passive = { passive: false } as const

        document.addEventListener(
            'gesturestart',
            preventDefaultGestures,
            passive
        )
        document.addEventListener(
            'gesturechange',
            preventDefaultGestures,
            passive
        )
        document.addEventListener('gestureend', preventDefaultGestures, passive)

        document.addEventListener('touchmove', preventPullToRefresh, passive)
        document.addEventListener('touchstart', preventDefaultTouch, passive)
        document.addEventListener('touchend', preventDoubleTapZoom, passive)

        document.addEventListener('contextmenu', preventContextMenu)

        document.addEventListener('scroll', preventScroll, passive)
        document.addEventListener('wheel', preventWheel, passive)
        document.addEventListener('mousewheel', preventWheel, passive)
        document.addEventListener('DOMMouseScroll', preventWheel, passive)
        document.addEventListener('keydown', preventKeyboardScroll, passive)

        document.body.addEventListener('scroll', preventScroll, passive)
        document.documentElement.addEventListener(
            'scroll',
            preventScroll,
            passive
        )

        window.scrollTo(0, 0)

        return () => {
            document.removeEventListener('gesturestart', preventDefaultGestures)
            document.removeEventListener(
                'gesturechange',
                preventDefaultGestures
            )
            document.removeEventListener('gestureend', preventDefaultGestures)

            document.removeEventListener('touchmove', preventPullToRefresh)
            document.removeEventListener('touchstart', preventDefaultTouch)
            document.removeEventListener('touchend', preventDoubleTapZoom)

            document.removeEventListener('contextmenu', preventContextMenu)

            document.removeEventListener('scroll', preventScroll)
            document.removeEventListener('wheel', preventWheel)
            document.removeEventListener('mousewheel', preventWheel)
            document.removeEventListener('DOMMouseScroll', preventWheel)
            document.removeEventListener('keydown', preventKeyboardScroll)

            document.body.removeEventListener('scroll', preventScroll)
            document.documentElement.removeEventListener(
                'scroll',
                preventScroll
            )
        }
    }, [])

    return null
}

const Editor = () => {
    const [isSmall, setIsSmall] = useState(window.innerWidth < 768)
    const [showOptions, setShowOptions] = useState(true)

    const sceneOptions = canvasRenderStore((state) => state.sceneOptions)

    const {
        newGroupModal,
        copyGroupModal,
        renameGroupModal,
        deleteGroupModal,
    } = dashboardStore(
        useShallow((state) => ({
            newGroupModal: state.newGroupModal,
            copyGroupModal: state.copyGroupModal,
            renameGroupModal: state.renameGroupModal,
            deleteGroupModal: state.deleteGroupModal,
        }))
    )

    const hasRun = useRef(false)

    const { pointerType, setPointerType } = canvasDrawStore(
        useShallow((state) => ({
            pointerType: state.pointerType,
            setPointerType: state.setPointerType,
        }))
    )
    const { addNewGroup, activeScene, setGroupData, setActiveGroup } =
        canvasRenderStore(
            useShallow((state) => ({
                addNewGroup: state.addNewGroup,
                activeScene: state.activeScene,
                setGroupData: state.setGroupData,
                setActiveGroup: state.setActiveGroup,
            }))
        )

    const { mode, resolved, setMode } = themeStore(
        useShallow((state) => ({
            mode: state.mode,
            resolved: state.resolved,
            setMode: state.setMode,
        }))
    )
    const setCanvasBackgroundColor = canvasRenderStore(
        (state) => state.setCanvasBackgroundColor
    )
    const historyApplying = historyStore((state) => state.busy)

    // Written only on theme change, so a colour picked in the render panel
    // survives until the next switch.
    useEffect(() => {
        setCanvasBackgroundColor(SCENE[resolved].canvas)
    }, [resolved, setCanvasBackgroundColor])

    /** Records the input device and clears the prompt. Deliberately picks no
        tool: arming one here locks orbit, so the first drag would draw. */
    const choosePointer = useCallback(
        (value: PointerType) => {
            setPointerType(value)
            dismissNotice(POINTER_PROMPT)
        },
        [setPointerType]
    )

    useEffect(() => {
        notifyInfo(
            <span className="flex items-center gap-[8px] font-funnel text-[12px] font-medium text-ink">
                <IconHandFinger
                    color="currentColor"
                    size={16}
                    stroke={1.5}
                    className="shrink-0 text-accent"
                />
                Select Pointer type first!
            </span>,
            {
                toastId: POINTER_PROMPT,
                // Closes itself once a pointer type is chosen, so a close
                // button would only discard the instruction unanswered.
                closeButton: false,
            }
        )

        // The first pointer to touch the app decides which device the editor
        // binds to, so a resting palm cannot draw while a stylus is in use.
        const onFirstPointerDown = (e: PointerEvent) => {
            choosePointer(e.pointerType as PointerType)
            window.removeEventListener('pointerdown', onFirstPointerDown, true)
        }

        window.addEventListener('pointerdown', onFirstPointerDown, true)
        return () =>
            window.removeEventListener('pointerdown', onFirstPointerDown, true)
    }, [choosePointer])

    // Ignored while a text field has focus, so a mistyped group name is still
    // corrected by the browser's own undo.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!event.ctrlKey && !event.metaKey) return

            const key = event.key.toLowerCase()
            if (key !== 'z' && key !== 'y') return

            const target = event.target
            if (
                target instanceof HTMLElement &&
                (target.isContentEditable ||
                    target.tagName === 'INPUT' ||
                    target.tagName === 'TEXTAREA')
            ) {
                return
            }

            event.preventDefault()
            const redo = key === 'y' || event.shiftKey
            historyStore.getState().request(redo ? 'redo' : 'undo')
        }

        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [])

    useEffect(() => {
        if (hasRun.current) return
        hasRun.current = true

        void fetchNoteData()
    }, [])

    const fetchNoteData = async () => {
        try {
            const { groupData } = await loadSceneFromIndexedDB()

            if (groupData.length > 0) {
                setGroupData(groupData)
                setActiveGroup(groupData.find((g) => g.active) ?? null)
            } else {
                const data: Group = {
                    uuid: uuidv4(),
                    name: 'Group 1',
                    created_at: new Date().toISOString(),
                    deleted_at: null,
                    visible: true,
                    active: true,
                    objects: [],
                }
                addNewGroup(data)
                setActiveGroup(data)

                // The first save of a new document, so there is nothing to
                // write incrementally against.
                await saveWholeScene(canvasRenderStore.getState().groupData)
                setGroupData(canvasRenderStore.getState().groupData)
            }
        } catch (error) {
            console.error(error)
            notifyError(
                error instanceof Error
                    ? error.message
                    : 'Could not load your saved scene.'
            )
        }
    }

    function downloadFile() {
        if (!activeScene) return

        const sceneToExport = activeScene.clone()
        const exporter = new GLTFExporter()

        exporter.parse(
            sceneToExport,
            (result) => {
                const output =
                    typeof result === 'string'
                        ? result
                        : JSON.stringify(result, null, 2)

                const blob = new Blob([output], { type: 'application/json' })
                const link = document.createElement('a')
                link.href = URL.createObjectURL(blob)
                link.download = `scene.gltf`
                link.click()
                URL.revokeObjectURL(link.href)
            },
            (error) => {
                console.error(error)
                notifyError('Could not export the scene.')
            },
            { binary: false, includeCustomExtensions: true }
        )
    }

    useEffect(() => {
        const onResize = () => setIsSmall(window.innerWidth < 768)
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
    }, [])

    return (
        <>
            <DisableBrowserGestures />

            <div className="z-5 flex h-screen w-screen overflow-hidden select-none">
                <div className="absolute top-[12px] left-[12px] z-5 flex items-center gap-[4px] rounded-[12px] border-[1px] border-line/25 bg-surface p-[4px]">
                    <button
                        onClick={() => setShowOptions(!showOptions)}
                        className="flex cursor-pointer justify-center rounded-[8px] p-[8px] font-bold hover:bg-surface-3"
                    >
                        <IconMenu2
                            color="currentColor"
                            size={isSmall ? 8 : 12}
                            stroke={1.5}
                        />
                    </button>
                </div>

                {showOptions && (
                    <div className="absolute top-[72px] left-[12px] z-5 flex-col items-center gap-[4px] rounded-[12px] border-[1px] border-line/25 bg-surface font-funnel text-[8px] font-normal drop-shadow-xl md:text-[12px]">
                        <ul>
                            <li
                                onClick={downloadFile}
                                className="m-[4px] flex cursor-pointer items-center justify-between gap-[12px] rounded-[8px] font-funnel text-[8px] font-normal hover:bg-surface-3 md:text-[12px]"
                            >
                                <ToolTip
                                    text="Download model"
                                    position="right"
                                    delay={100}
                                >
                                    <button className="flex cursor-pointer items-center justify-center rounded-[8px] px-[8px] font-bold">
                                        <IconDownload
                                            color="currentColor"
                                            size={isSmall ? 12 : 16}
                                            stroke={1.5}
                                        />

                                        <div className="p-[12px] font-funnel font-normal">
                                            Download file
                                        </div>
                                    </button>
                                </ToolTip>
                            </li>

                            <li className="m-[4px] flex cursor-pointer items-center justify-between gap-[12px] rounded-[8px] font-funnel text-[8px] font-normal hover:bg-surface-3 md:text-[12px]">
                                <ToolTip
                                    text="GitHub"
                                    position="bottom"
                                    delay={100}
                                >
                                    <a
                                        className="flex cursor-pointer items-center justify-center rounded-[8px] px-[8px] font-bold"
                                        href="https://github.com/SW881/petals-3d"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        <div>
                                            <IconBrandGithub
                                                color="currentColor"
                                                size={isSmall ? 12 : 16}
                                                stroke={1.5}
                                            />
                                        </div>

                                        <div className="p-[12px] font-funnel font-normal">
                                            GitHub
                                        </div>
                                    </a>
                                </ToolTip>
                            </li>

                            <li className="flex border-b-[1px] border-line/25"></li>

                            <li className="m-[4px] flex items-center justify-between gap-[12px] p-[4px]">
                                <div>Pointer</div>
                                <div className="flex items-center justify-between gap-[4px]">
                                    <ToolTip
                                        text="Stylus"
                                        position="bottom"
                                        delay={100}
                                    >
                                        <button
                                            onClick={() => choosePointer('pen')}
                                            className={`flex cursor-pointer justify-center rounded-[8px] p-[8px] font-bold ${
                                                pointerType === 'pen'
                                                    ? 'bg-accent text-accent-ink'
                                                    : 'hover:bg-surface-3'
                                            }`}
                                        >
                                            <IconBallpen
                                                color="currentColor"
                                                size={isSmall ? 12 : 20}
                                                stroke={1.5}
                                            />
                                        </button>
                                    </ToolTip>

                                    <ToolTip
                                        text="Mouse"
                                        position="bottom"
                                        delay={100}
                                    >
                                        <button
                                            onClick={() =>
                                                choosePointer('mouse')
                                            }
                                            className={`flex cursor-pointer justify-center rounded-[8px] p-[8px] font-bold ${
                                                pointerType === 'mouse'
                                                    ? 'bg-accent text-accent-ink'
                                                    : 'hover:bg-surface-3'
                                            }`}
                                        >
                                            <IconMouse
                                                color="currentColor"
                                                size={isSmall ? 12 : 20}
                                                stroke={1.5}
                                            />
                                        </button>
                                    </ToolTip>

                                    <ToolTip
                                        text="Touch"
                                        position="bottom"
                                        delay={100}
                                    >
                                        <button
                                            onClick={() =>
                                                choosePointer('touch')
                                            }
                                            className={`flex cursor-pointer justify-center rounded-[8px] p-[8px] font-bold ${
                                                pointerType === 'touch'
                                                    ? 'bg-accent text-accent-ink'
                                                    : 'hover:bg-surface-3'
                                            }`}
                                        >
                                            <IconHandFinger
                                                color="currentColor"
                                                size={isSmall ? 12 : 20}
                                                stroke={1.5}
                                            />
                                        </button>
                                    </ToolTip>
                                </div>
                            </li>

                            <li className="flex border-b-[1px] border-line/25"></li>

                            <li className="flex border-b-[1px] border-line/25"></li>

                            <li className="m-[4px] flex items-center justify-between gap-[12px] p-[4px]">
                                <div>Theme</div>
                                <div className="flex items-center justify-between gap-[4px]">
                                    {THEME_OPTIONS.map((option) => (
                                        <ToolTip
                                            key={option.mode}
                                            text={option.label}
                                            position="bottom"
                                            delay={100}
                                        >
                                            <button
                                                onClick={() =>
                                                    setMode(option.mode)
                                                }
                                                className={`flex cursor-pointer justify-center rounded-[8px] p-[8px] font-bold ${
                                                    mode === option.mode
                                                        ? 'bg-accent text-accent-ink'
                                                        : 'hover:bg-surface-3'
                                                }`}
                                            >
                                                <option.Icon
                                                    color="currentColor"
                                                    size={isSmall ? 12 : 20}
                                                    stroke={1.5}
                                                />
                                            </button>
                                        </ToolTip>
                                    ))}
                                </div>
                            </li>
                        </ul>
                    </div>
                )}

                {sceneOptions && newGroupModal && <AddNewGroups />}
                {sceneOptions && renameGroupModal && <RenameGroups />}
                {sceneOptions && copyGroupModal && <CopyGroups />}
                {sceneOptions && deleteGroupModal && <DeleteGroups />}

                {/* Reaching for a tool means you are done with the menu, and
                    both panels overlap its column. Capture phase, so a child
                    that stops propagation cannot leave the menu stuck open. */}
                <div onPointerDownCapture={() => setShowOptions(false)}>
                    <ToolPanel isSmall={isSmall} />
                </div>
                <div className="size-full grow">
                    <Canvas3d />
                </div>
                <div onPointerDownCapture={() => setShowOptions(false)}>
                    <ViewsPanel isSmall={isSmall} />
                </div>

                <Joystick />

                {/* Swallows every pointer event while an undo is applying.
                    Each tool already refuses to act, but an entry touches the
                    scene, the document and the stacks in turn, and a click
                    landing between those steps sees an inconsistent editor. */}
                {historyApplying && (
                    <div
                        className="fixed inset-0 z-20 cursor-wait"
                        aria-hidden="true"
                    />
                )}
            </div>
        </>
    )
}

export default Editor
