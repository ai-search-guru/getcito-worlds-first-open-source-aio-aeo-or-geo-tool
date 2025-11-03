'use client'
import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'gradient' | 'elevated';
}

export default function Card({ 
  children, 
  className = '', 
  padding = 'md',
  variant = 'default'
}: CardProps): React.ReactElement {
  const paddingClasses = {
    sm: 'p-4',
    md: 'p-6',
    lg: 'p-8',
  };

  const variantClasses = {
    default: 'bg-card border border-border',
    gradient: 'bg-gradient-to-br from-card to-muted border border-border',
    elevated: 'bg-card border border-border shadow-lg shadow-black/5 dark:shadow-black/20',
  };

  return (
    <div className={`${variantClasses[variant]} rounded-xl backdrop-blur-sm transition-all duration-200 hover:border-accent ${paddingClasses[padding]} ${className}`}>
      {children}
    </div>
  );
} 