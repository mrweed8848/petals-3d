import { useCallback, useEffect, memo } from 'react'

import {
    IconArrowBackUp,
    IconArrowForwardUp,
    IconGrid4x4,
    IconLock,
    IconMaximize,
    IconPerspective,
} from '@tabler/icons-react'
import { useShallow } from 'zustand/react/shallow'

import OrthograhicView from '../svg-icons/OrthograhicView'

import { canvasViewStore } from '../../hooks/useCanvasViewStore'
import { historyStore } from '../../hooks/useHistoryStore'

import RangeSlider from '../RangeSlider'
import ToolTip from '../ToolTip'
import Divider from '../Divider'

type ViewAction = 'fov_slider' | 'grids'

export interface ViewsPanelProps {
    isSmall: boolean
}

/** Camera and viewport controls. Nothing here touches drawn geometry. */
const ViewsPanel = ({ isSmall }: ViewsPanelProps) => {
    const { canUndo, canRedo, busy, request, past, future } = historyStore(
        useShallow((state) => ({
            canUndo: state.canUndo,
            canRedo: state.canRedo,
            busy: state.busy,
            request: state.request,
            past: state.past,
            future: state.future,
        }))
    )

    const {
        orbitalLock,
        setOrbitalLock,
        showFovSlider,
        setShowFovSlider,
        gridPlaneX,
        gridPlaneY,
        gridPlaneZ,
        setGridPlaneX,
        setGridPlaneY,
        setGridPlaneZ,
        showGridOptions,
        setShowGridOptions,
        cameraFov,
        setCameraFov,
        isOrthographic,
        setIsOrthographic,
        fullScreen,
        setFullScreen,
    } = canvasViewStore(
        useShallow((state) => ({
            orbitalLock: state.orbitalLock,
            setOrbitalLock: state.setOrbitalLock,
            showFovSlider: state.showFovSlider,
            setShowFovSlider: state.setShowFovSlider,
            gridPlaneX: state.gridPlaneX,
            gridPlaneY: state.gridPlaneY,
            gridPlaneZ: state.gridPlaneZ,
            setGridPlaneX: state.setGridPlaneX,
            setGridPlaneY: state.setGridPlaneY,
            setGridPlaneZ: state.setGridPlaneZ,
            showGridOptions: state.showGridOptions,
            setShowGridOptions: state.setShowGridOptions,
            cameraFov: state.cameraFov,
            setCameraFov: state.setCameraFov,
            isOrthographic: state.isOrthographic,
            setIsOrthographic: state.setIsOrthographic,
            fullScreen: state.fullScreen,
            setFullScreen: state.setFullScreen,
        }))
    )

    function handleViewActions(action: ViewAction) {
        switch (action) {
            case 'fov_slider':
                setShowGridOptions(false)
                setShowFovSlider(!showFovSlider)
                break
            case 'grids':
                setShowFovSlider(false)
                setShowGridOptions(!showGridOptions)
                break
        }
    }

    const handleFullscreenToggle = useCallback(async () => {
        const root = document.documentElement

        if (!document.fullscreenElement) {
            if (root.requestFullscreen) {
                await root.requestFullscreen()
            } else if (root.webkitRequestFullscreen) {
                await root.webkitRequestFullscreen()
            }
            setFullScreen(true)
        } else {
            if (document.exitFullscreen) {
                await document.exitFullscreen()
            } else if (document.webkitExitFullscreen) {
                await document.webkitExitFullscreen()
            }
            setFullScreen(false)
        }
    }, [setFullScreen])

    useEffect(() => {
        const handleFullscreenChange = () => {
            setFullScreen(!!document.fullscreenElement)
        }

        document.addEventListener('fullscreenchange', handleFullscreenChange)
        document.addEventListener(
            'webkitfullscreenchange',
            handleFullscreenChange
        )

        return () => {
            document.removeEventListener(
                'fullscreenchange',
                handleFullscreenChange
            )
            document.removeEventListener(
                'webkitfullscreenchange',
                handleFullscreenChange
            )
        }
    }, [setFullScreen])

    return (
        <>
            <div className="absolute bottom-[16px] left-[12px] flex flex-col gap-[4px] rounded-[12px] border-[1px] border-line/25 bg-surface p-[4px] text-ink drop-shadow-xl">
                <ToolTip text="Full screen" position="right" delay={100}>
                    <button
                        onClick={() => void handleFullscreenToggle()}
                        className={`flex cursor-pointer justify-center rounded-[8px] border-[0px] p-[8px] font-bold ${
                            fullScreen
                                ? 'bg-accent text-accent-ink'
                                : 'hover:bg-surface-3'
                        }`}
                    >
                        <IconMaximize
                            color="currentColor"
                            size={isSmall ? 12 : 20}
                            stroke={1.5}
                        />
                    </button>
                </ToolTip>

                <ToolTip text="Perfect View" position="right" delay={100}>
                    <button
                        onClick={() => setIsOrthographic(!isOrthographic)}
                        className={`flex cursor-pointer justify-center rounded-[8px] border-[0px] p-[8px] font-bold ${
                            isOrthographic
                                ? 'bg-accent text-accent-ink'
                                : 'hover:bg-surface-3'
                        }`}
                    >
                        <OrthograhicView
                            color="currentColor"
                            size={isSmall ? 12 : 20}
                        />
                    </button>
                </ToolTip>

                <ToolTip text="Fov Slider" position="right" delay={100}>
                    <button
                        disabled={isOrthographic}
                        onClick={() => handleViewActions('fov_slider')}
                        className={`flex cursor-pointer justify-center rounded-[8px] border-[0px] p-[8px] font-bold ${
                            showFovSlider && !isOrthographic
                                ? 'bg-accent text-accent-ink'
                                : 'hover:bg-surface-3'
                        }`}
                    >
                        <IconPerspective
                            color="currentColor"
                            size={isSmall ? 12 : 20}
                            stroke={1.5}
                        />
                    </button>
                </ToolTip>

                <Divider orientation="horizontal" />

                <ToolTip text="Enable Grids" position="right" delay={100}>
                    <button
                        onClick={() => handleViewActions('grids')}
                        className={`flex cursor-pointer justify-center rounded-[8px] border-[0px] p-[8px] font-bold ${
                            showGridOptions
                                ? 'bg-accent text-accent-ink'
                                : 'hover:bg-surface-3'
                        }`}
                    >
                        <IconGrid4x4
                            color="currentColor"
                            size={isSmall ? 12 : 20}
                            stroke={1.5}
                        />
                    </button>
                </ToolTip>

                <ToolTip text="Orbit Lock" position="right" delay={100}>
                    <button
                        onClick={() => setOrbitalLock(!orbitalLock)}
                        className={`flex cursor-pointer justify-center rounded-[8px] border-[0px] p-[8px] font-bold ${
                            orbitalLock
                                ? 'bg-accent text-accent-ink'
                                : 'hover:bg-surface-3'
                        }`}
                    >
                        <IconLock
                            color="currentColor"
                            size={isSmall ? 12 : 20}
                            stroke={1.5}
                        />
                    </button>
                </ToolTip>

                <Divider orientation="horizontal" />

                {/* Both disabled while an entry is applying, not just the one
                    in use: a second request would interleave two sets of
                    writes over the same records. */}
                <ToolTip
                    text={
                        past.length > 0
                            ? `Undo ${past[past.length - 1].label} (Ctrl+Z)`
                            : 'Nothing to undo'
                    }
                    position="right"
                    delay={100}
                >
                    <button
                        onClick={() => request('undo')}
                        disabled={!canUndo || busy}
                        className="z-5 cursor-pointer rounded-[8px] border-[0px] p-[8px] font-bold hover:bg-surface-3 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                        <IconArrowBackUp
                            color="currentColor"
                            size={isSmall ? 12 : 20}
                            stroke={1.5}
                        />
                    </button>
                </ToolTip>

                <ToolTip
                    text={
                        future.length > 0
                            ? `Redo ${future[0].label} (Ctrl+Shift+Z)`
                            : 'Nothing to redo'
                    }
                    position="right"
                    delay={100}
                >
                    <button
                        onClick={() => request('redo')}
                        disabled={!canRedo || busy}
                        className="z-5 cursor-pointer rounded-[8px] border-[0px] p-[8px] font-bold hover:bg-surface-3 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                        <IconArrowForwardUp
                            color="currentColor"
                            size={isSmall ? 12 : 20}
                            stroke={1.5}
                        />
                    </button>
                </ToolTip>
            </div>

            {showFovSlider && !isOrthographic && (
                <div className="absolute bottom-[140px] left-[58px] z-5 w-[140px] rounded-[12px] border-[1px] border-line/25 bg-surface text-ink drop-shadow-xl md:bottom-[184px] md:left-[72px] md:w-[198px]">
                    <RangeSlider
                        name="Camera Fov"
                        max={100}
                        min={0}
                        step={1}
                        value={cameraFov}
                        setUpdatingValue={setCameraFov}
                    />
                </div>
            )}

            {showGridOptions && (
                <div className="absolute bottom-[208px] left-[58px] z-5 flex justify-center gap-[4px] rounded-[12px] border-[1px] border-line/25 bg-surface p-[4px] text-ink drop-shadow-xl md:bottom-[256px] md:left-[72px]">
                    <button
                        onClick={() => setGridPlaneX(!gridPlaneX)}
                        className={`${
                            gridPlaneX ? 'bg-axis-x/50' : 'hover:bg-surface-3'
                        } z-5 cursor-pointer rounded-[8px] border-[0px] p-[8px] font-bold`}
                    >
                        <IconGrid4x4
                            color="#DE3163"
                            size={isSmall ? 12 : 20}
                            stroke={1.5}
                        />
                    </button>

                    <button
                        onClick={() => setGridPlaneY(!gridPlaneY)}
                        className={`${
                            gridPlaneY ? 'bg-axis-y/50' : 'hover:bg-surface-3'
                        } z-5 cursor-pointer rounded-[8px] border-[0px] p-[8px] font-bold`}
                    >
                        <IconGrid4x4
                            color="#50C878"
                            size={isSmall ? 12 : 20}
                            stroke={1.5}
                        />
                    </button>

                    <button
                        onClick={() => setGridPlaneZ(!gridPlaneZ)}
                        className={`${
                            gridPlaneZ ? 'bg-axis-z/50' : 'hover:bg-surface-3'
                        } z-5 cursor-pointer rounded-[8px] border-[0px] p-[8px] font-bold`}
                    >
                        <IconGrid4x4
                            color="#0096FF"
                            size={isSmall ? 12 : 20}
                            stroke={1.5}
                        />
                    </button>
                </div>
            )}
        </>
    )
}

export default memo(ViewsPanel)
