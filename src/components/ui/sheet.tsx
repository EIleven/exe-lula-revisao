"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Sheet = SheetPrimitive.Root

const SheetTrigger = SheetPrimitive.Trigger

const SheetClose = SheetPrimitive.Close

const SheetPortal = SheetPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref}
  />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

const sheetVariants = cva(
  "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4  border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  }
)

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

/** Puxar a folha de baixo para fechar: distância (px) ou velocidade (px/ms) que decide fechar ao soltar. */
const SHEET_DISMISS_DISTANCE = 100
const SHEET_DISMISS_VELOCITY = 0.5

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = "right", className, children, style, ...props }, ref) => {
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const drag = React.useRef<{
    source: "pointer" | "touch"
    startY: number
    lastY: number
    startTime: number
  } | null>(null)
  const [dragY, setDragY] = React.useState(0)
  const [dragging, setDragging] = React.useState(false)

  // Folha de baixo (celular): a alça no topo acompanha o dedo para baixo e, soltando longe ou rápido, fecha pelo mesmo
  // botão de fechar (o diálogo faz a saída animada e devolve o foco). A alça é a única área de arrasto: a rolagem do
  // conteúdo da folha fica livre.
  const beginDrag = (source: "pointer" | "touch", clientY: number) => {
    if (drag.current) return false
    drag.current = {
      source,
      startY: clientY,
      lastY: clientY,
      startTime: performance.now(),
    }
    setDragging(true)
    return true
  }
  const moveDrag = (source: "pointer" | "touch", clientY: number) => {
    const current = drag.current
    if (!current || current.source !== source) return
    current.lastY = clientY
    setDragY(Math.max(0, clientY - current.startY))
  }
  const finishDrag = (
    source: "pointer" | "touch",
    clientY: number | undefined,
    cancelled: boolean
  ) => {
    const current = drag.current
    if (!current || current.source !== source) return
    drag.current = null
    setDragging(false)
    const dy = Math.max(0, (clientY ?? current.lastY) - current.startY)
    const velocity = dy / Math.max(1, performance.now() - current.startTime)
    if (!cancelled && (dy >= SHEET_DISMISS_DISTANCE || (dy > 30 && velocity >= SHEET_DISMISS_VELOCITY))) {
      closeRef.current?.click()
    }
    setDragY(0)
  }
  const onGrabberDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!beginDrag("pointer", event.clientY)) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const onGrabberMove = (event: React.PointerEvent<HTMLDivElement>) => {
    moveDrag("pointer", event.clientY)
  }
  const onGrabberUp = (event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    finishDrag("pointer", event.clientY, cancelled)
  }

  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={ref}
        className={cn(sheetVariants({ side }), className)}
        style={side === "bottom" && dragY > 0 ? { ...style, transform: `translateY(${dragY}px)`, transition: dragging ? "none" : undefined } : style}
        {...props}
      >
        {side === "bottom" && (
          <div
            className="absolute inset-x-0 top-0 z-10 flex h-6 cursor-grab touch-none items-start justify-center pt-2 active:cursor-grabbing"
            onPointerDown={onGrabberDown}
            onPointerMove={onGrabberMove}
            onPointerUp={(event) => onGrabberUp(event, false)}
            onPointerCancel={(event) => onGrabberUp(event, true)}
            onTouchStart={(event) => {
              if (event.touches.length === 1) {
                // Browsers modernos emitem pointerdown antes de touchstart.
                // A sequência de toque assume o gesto daqui em diante para
                // não ficar presa se o navegador cancelar apenas o pointer.
                drag.current = null
                beginDrag("touch", event.touches[0].clientY)
              }
            }}
            onTouchMove={(event) => {
              if (event.touches.length === 1) {
                moveDrag("touch", event.touches[0].clientY)
              }
            }}
            onTouchEnd={(event) => {
              finishDrag("touch", event.changedTouches[0]?.clientY, false)
            }}
            onTouchCancel={(event) => {
              finishDrag("touch", event.changedTouches[0]?.clientY, true)
            }}
            data-testid="sheet-grabber"
            aria-hidden="true"
          >
            <span className="h-1.5 w-12 rounded-full bg-muted-foreground/40" />
          </div>
        )}
        {children}
        <SheetPrimitive.Close ref={closeRef} className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  )
})
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-2 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
SheetHeader.displayName = "SheetHeader"

const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
SheetFooter.displayName = "SheetFooter"

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props}
  />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
