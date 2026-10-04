/**
 * Responsive components for Arena's role-aware interface
 * 
 * These components provide responsive UI patterns that work across
 * all device sizes while respecting the canonical object contracts.
 */

import React from 'react';
import { cn } from '../utils';
import { useResponsiveLayout, useTouchGesture } from '../hooks';

/**
 * Responsive container that adapts to different screen sizes
 */
interface ResponsiveContainerProps {
  children: React.ReactNode;
  className?: string;
  maxWidth?: 'mobile' | 'tablet' | 'desktop';
}

export function ResponsiveContainer({ 
  children, 
  className,
  maxWidth: _maxWidth = 'desktop'
}: ResponsiveContainerProps) {
  const { breakpoint } = useResponsiveLayout();

  const widthClasses = {
    mobile: 'px-4',
    tablet: 'px-6',
    desktop: 'px-8',
  } as const;

  return (
    <div className={cn(
      'mx-auto w-full',
      widthClasses[breakpoint as keyof typeof widthClasses],
      className
    )}>
      {children}
    </div>
  );
}

/**
 * Responsive navigation that switches between bottom nav (mobile) and side rail (desktop)
 */
interface ResponsiveNavigationProps {
  children: React.ReactNode;
  mobileNav?: React.ReactNode;
  desktopNav?: React.ReactNode;
}

export function ResponsiveNavigation({ 
  children, 
  mobileNav,
  desktopNav 
}: ResponsiveNavigationProps) {
  const { showBottomNav, showSideRail } = useResponsiveLayout();

  return (
    <>
      {/* Desktop side rail */}
      {showSideRail && desktopNav && (
        <div className="hidden lg:block w-64 border-r border-gray-200">
          {desktopNav}
        </div>
      )}
      
      {/* Main content area */}
      <div className={cn(
        "flex-1",
        showSideRail && "lg:ml-64"
      )}>
        {children}
      </div>
      
      {/* Mobile bottom nav */}
      {showBottomNav && mobileNav && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 border-t border-gray-200 bg-white">
          {mobileNav}
        </div>
      )}
    </>
  );
}

/**
 * Responsive layout grid that adapts to screen size
 */
interface ResponsiveGridProps {
  children: React.ReactNode;
  className?: string;
  mobileCols?: number;
  tabletCols?: number;
  desktopCols?: number;
  gap?: string;
}

export function ResponsiveGrid({ 
  children, 
  className,
  mobileCols = 1,
  tabletCols = 2,
  desktopCols = 3,
  gap = 'gap-4'
}: ResponsiveGridProps) {
  const gridClasses = cn(
    'grid',
    gap,
    {
      'grid-cols-1': mobileCols === 1,
      'grid-cols-2': mobileCols === 2,
      'grid-cols-3': mobileCols === 3,
    },
    {
      'md:grid-cols-2': tabletCols === 2,
      'md:grid-cols-3': tabletCols === 3,
    },
    {
      'lg:grid-cols-3': desktopCols === 3,
      'lg:grid-cols-4': desktopCols === 4,
    },
    className
  );

  return (
    <div className={gridClasses}>
      {children}
    </div>
  );
}

/**
 * Responsive card that adapts to screen size
 */
interface ResponsiveCardProps {
  children: React.ReactNode;
  className?: string;
  mobileFull?: boolean;
  tabletFull?: boolean;
}

export function ResponsiveCard({ 
  children, 
  className,
  mobileFull = true,
  tabletFull = false
}: ResponsiveCardProps) {
  const cardClasses = cn(
    'bg-white rounded-lg border border-gray-200 p-6',
    {
      'w-full': mobileFull,
      'md:w-full': tabletFull,
    },
    className
  );

  return (
    <div className={cardClasses}>
      {children}
    </div>
  );
}

/**
 * Touch-friendly button for mobile interactions
 */
interface TouchButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  className?: string;
  touchFeedback?: boolean;
}

export function TouchButton({ 
  children, 
  className,
  touchFeedback = true,
  ...props 
}: TouchButtonProps) {
  const { gesture: _gesture, handleTouchStart, handleTouchMove, handleTouchEnd } = useTouchGesture();

  return (
    <button
      className={cn(
        "px-4 py-2 rounded-md font-medium transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500",
        touchFeedback && "active:bg-gray-100",
        className
      )}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * Responsive table with horizontal scroll on mobile
 */
interface ResponsiveTableProps {
  children: React.ReactNode;
  className?: string;
  headers: string[];
}

export function ResponsiveTable({ 
  children, 
  className,
  headers 
}: ResponsiveTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className={cn(
        "w-full border-collapse",
        className
      )}>
        <thead>
          <tr className="border-b border-gray-200">
            {headers.map((header, index) => (
              <th 
                key={index}
                className="px-4 py-3 text-left text-sm font-medium text-gray-700 bg-gray-50"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {children}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Responsive modal that adapts to screen size
 */
interface ResponsiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function ResponsiveModal({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  className 
}: ResponsiveModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className={cn(
        "bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto",
        "md:max-w-3xl lg:max-w-4xl",
        className
      )}>
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">
            {title}
          </h2>
          <button
            onClick={onClose}
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

/**
 * Responsive bottom sheet for mobile interactions
 */
interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  className?: string;
}

export function BottomSheet({ 
  isOpen, 
  onClose, 
  children, 
  title,
  className 
}: BottomSheetProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* Overlay */}
      <div 
        className="flex-1 bg-black bg-opacity-50"
        onClick={onClose}
      />
      
      {/* Sheet */}
      <div className={cn(
        "bg-white rounded-t-2xl shadow-xl max-h-[80vh] overflow-y-auto",
        "animate-slide-up",
        className
      )}>
        {title && (
          <div className="flex items-center justify-between p-4 border-b">
            <h3 className="text-lg font-semibold text-gray-900">
              {title}
            </h3>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <div className="p-4">
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Responsive tabs that adapt to screen size
 */
interface ResponsiveTabsProps {
  tabs: Array<{
    id: string;
    label: string;
    panelId: string;
  }>;
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

export function ResponsiveTabs({ 
  tabs, 
  activeTab, 
  onTabChange, 
  className 
}: ResponsiveTabsProps) {
  const { isMobile } = useResponsiveLayout();

  if (isMobile) {
    return (
      <div className="flex overflow-x-auto space-x-1 pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              activeTab === tab.id
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)}>
      <div className="flex space-x-1 border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
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
    </div>
  );
}