'use client'
import React from 'react';
import { X } from 'lucide-react';

interface BrandTrackingModalProps {
  isOpen: boolean;
  onStartTracking: () => void;
  onClose: () => void;
  brandName?: string;
}

export default function BrandTrackingModal({ 
  isOpen, 
  onStartTracking, 
  onClose, 
  brandName 
}: BrandTrackingModalProps): React.ReactElement | null {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full p-6 relative border border-gray-200 dark:border-gray-700">
        {/* Close button */}
        <button
                onClick={() => {
            console.log('🧹 Clearing localStorage selectedBrandId');
            localStorage.removeItem('selectedBrandId');
            window.location.reload();
          }}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Content */}
        <div className="space-y-4">
          <div className="text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-[#000C60] to-[#00B087] rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">🎯</span>
            </div>
            
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              Heads up!
            </h3>
            
            <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
              Looks like the brand {brandName && (
                <span className="font-semibold text-[#000C60] dark:text-[#00B087]">"{brandName}"</span>
              )} is flying under our radar, for now. So, we don't have any historical data (yet), but don't worry—we're on the case and will start monitoring it from today.
            </p>
          </div>

          {/* Action Button */}
          <div className="pt-4">
            <button
              onClick={onStartTracking}
              className="w-full bg-gradient-to-r from-[#000C60] to-[#00B087] text-white font-semibold py-3 px-6 rounded-xl hover:shadow-lg hover:scale-[1.02] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#000C60]/50"
            >
              Great, Start Tracking!
            </button>
          </div>
        </div>
      </div>
    </div>
  );
} 