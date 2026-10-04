/**
 * Accessibility components for Arena's role-aware interface
 * 
 * These components provide accessible UI patterns that work across
 * all role-specific screens while respecting the canonical object contracts.
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { useSkipNavigation } from '../hooks';

interface AccessibleModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function AccessibleModal({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  className 
}: AccessibleModalProps) {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const { SkipLink } = useSkipNavigation();

  // Focus trap effect
  React.useEffect(() => {
    if (!isOpen || !dialogRef.current) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <SkipLink />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title}
        className={cn(
          "bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto",
          className
        )}
      >
        <div className="flex items-center justify-between p-6 border-b">
          <h2 
            id={title}
            className="text-xl font-semibold text-gray-900"
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6">
          {children}
        </div>
      </div>
    </div>
  );
}

interface AccessibleTabsProps {
  tabs: Array<{
    id: string;
    label: string;
    panelId: string;
  }>;
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

export function AccessibleTabs({ 
  tabs, 
  activeTab, 
  onTabChange, 
  className 
}: AccessibleTabsProps) {
  return (
    <div className={cn("w-full", className)}>
      <div
        role="tablist"
        aria-orientation="horizontal"
        className="flex space-x-1 border-b border-gray-200"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            id={`${tab.id}-tab`}
            aria-selected={activeTab === tab.id}
            aria-controls={tab.panelId}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={tab.panelId}
          aria-labelledby={`${tab.id}-tab`}
          hidden={activeTab !== tab.id}
          className="mt-4"
        >
          {/* Tab content would be rendered here by parent */}
        </div>
      ))}
    </div>
  );
}

interface AccessibleFormFieldProps {
  id: string;
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function AccessibleFormField({ 
  id, 
  label, 
  error, 
  required, 
  children, 
  className 
}: AccessibleFormFieldProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <label 
        htmlFor={id}
        className={cn(
          "block text-sm font-medium",
          error ? "text-red-600" : "text-gray-700"
        )}
      >
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

interface AccessibleSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function AccessibleSpinner({ size = 'md', className }: AccessibleSpinnerProps) {
  const sizeClasses = {
    sm: "w-4 h-4",
    md: "w-6 h-6", 
    lg: "w-8 h-8"
  };

  return (
    <div 
      className={cn("inline-block animate-spin", sizeClasses[size], className)}
      role="status"
      aria-label="Loading"
    >
      <svg className="animate-spin" fill="none" viewBox="0 0 24 24">
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    </div>
  );
}

interface AccessibleButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  icon?: React.ReactNode;
}

export function AccessibleButton({ 
  variant = 'primary', 
  loading = false, 
  icon, 
  children, 
  disabled,
  className,
  ...props 
}: AccessibleButtonProps) {
  const isDisabled = disabled || loading;

  const variantClasses = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400",
    secondary: "bg-gray-200 text-gray-800 hover:bg-gray-300 disabled:bg-gray-100",
    danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-400"
  };

  return (
    <button
      disabled={isDisabled}
      className={cn(
        "inline-flex items-center justify-center px-4 py-2 rounded-md font-medium transition-colors",
        variantClasses[variant],
        "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500",
        className
      )}
      aria-busy={loading}
      {...props}
    >
      {loading && <AccessibleSpinner className="mr-2" />}
      {icon && !loading && <span className="mr-2">{icon}</span>}
      {children}
    </button>
  );
}

export function LiveRegion() {
  return (
    <div
      id="live-region"
      className="sr-only"
      aria-live="polite"
      aria-atomic="true"
    />
  );
}