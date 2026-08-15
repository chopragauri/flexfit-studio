"use client";

type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer: React.ReactNode;
};

/** A centred dialog that closes on backdrop click. */
export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: ModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="panel w-[90%] max-w-lg space-y-4 p-6"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {subtitle && <p className="muted mt-1 text-sm">{subtitle}</p>}
        </div>
        {children}
        <div className="flex justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}
