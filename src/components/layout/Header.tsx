'use client'
import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Download, Filter, Calendar, Bell, Search, Plus } from 'lucide-react';
// TODO: Restore theme switching functionality in the future
// import ThemeToggle from '@/components/shared/ThemeToggle';
import { useBrandContext } from '@/context/BrandContext';
import WebLogo from '@/components/shared/WebLogo';
import Link from 'next/link';

interface HeaderProps {
  title?: string;
}

export default function Header({ title }: HeaderProps): React.ReactElement {
  const [selectedPlatform, setSelectedPlatform] = useState('ChatGPT');
  const [selectedTimeframe, setSelectedTimeframe] = useState('Last 30 days');
  const [isBrandDropdownOpen, setIsBrandDropdownOpen] = useState(false);
  const { selectedBrand, brands, setSelectedBrandId } = useBrandContext();
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsBrandDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const platforms = ['ChatGPT', 'Perplexity', 'Google API', 'Claude', 'Gemini'];
  const timeframes = ['Last 7 days', 'Last 30 days', 'Last 90 days', 'Last 6 months', 'Last year'];

  return (
    <header className="bg-background border-b border-border px-6 py-4 shadow-sm">
      <div className="flex items-center justify-between">
        {/* Title Section */}
        <div className="flex items-center space-x-4">
          <div>
            {title && <h1 className="text-2xl font-bold text-foreground">{title}</h1>}
          </div>
        </div>

        {/* Controls Section */}
        <div className="flex items-center space-x-4">
          {/* Search - Temporarily commented out */}
          {/* <div className="hidden md:flex relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search brands, mentions..."
              className="bg-card border border-border text-foreground pl-10 pr-4 py-2 rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-sm w-64 transition-colors"
            />
          </div> */}

          {/* Time period selector - Temporarily commented out */}
          {/* <div className="relative">
            <select
              value={selectedTimeframe}
              onChange={(e) => setSelectedTimeframe(e.target.value)}
              className="appearance-none bg-card border border-border text-foreground px-4 py-2 pr-10 rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-sm hover:bg-accent transition-colors cursor-pointer"
            >
              {timeframes.map((timeframe) => (
                <option key={timeframe} value={timeframe} className="bg-card">
                  {timeframe}
                </option>
              ))}
            </select>
            <Calendar className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div> */}

          {/* Platform selector - Temporarily commented out */}
          {/* <div className="relative">
            <select
              value={selectedPlatform}
              onChange={(e) => setSelectedPlatform(e.target.value)}
              className="appearance-none bg-card border border-border text-foreground px-4 py-2 pr-10 rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-sm hover:bg-accent transition-colors cursor-pointer"
            >
              {platforms.map((platform) => (
                <option key={platform} value={platform} className="bg-card">
                  {platform}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div> */}

          {/* Action Buttons */}
          <div className="flex items-center space-x-3">
            {/* Theme Toggle */}
            {/* <ThemeToggle /> */}

            {/* Notifications - Temporarily commented out */}
            {/* <button className="relative p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors">
              <Bell className="h-5 w-5" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-destructive rounded-full"></span>
            </button> */}

            {/* Filter button - COMMENTED OUT */}
            {/* <button className="flex items-center space-x-2 bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary px-4 py-2 rounded-lg transition-colors">
              <Filter className="h-4 w-4" />
              <span className="text-sm hidden sm:inline">Filter</span>
            </button> */}

            {/* Brand Selection Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setIsBrandDropdownOpen(!isBrandDropdownOpen)}
                className="flex items-center space-x-2 bg-card border border-border hover:bg-accent px-4 py-2 rounded-xl transition-colors min-w-[200px]"
              >
                {selectedBrand ? (
                  <>
                    <WebLogo domain={selectedBrand.domain} size={20} />
                    <div className="text-left flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{selectedBrand.companyName}</p>
                      <p className="text-xs text-muted-foreground truncate">{selectedBrand.domain}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-5 h-5 bg-muted rounded-full"></div>
                    <div className="text-left flex-1 min-w-0">
                      <p className="text-sm font-medium text-muted-foreground">No Brand Selected</p>
                      <p className="text-xs text-muted-foreground">Click to select</p>
                    </div>
                  </>
                )}
                <div className="flex-shrink-0">
                  {isBrandDropdownOpen ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </button>

              {/* Dropdown Menu */}
              {isBrandDropdownOpen && (
                <div className="absolute top-full right-0 mt-1 bg-background border border-border rounded-xl shadow-lg z-50 w-64 max-h-48 overflow-y-auto">
                  {/* Show brands if available */}
                  {brands.length > 0 ? (
                    <>
                      {/* All Brands */}
                      {brands.map((brand) => (
                        <button
                          key={brand.id}
                          onClick={() => {
                            setSelectedBrandId(brand.id);
                            setIsBrandDropdownOpen(false);
                          }}
                          className={`w-full flex items-center space-x-3 p-3 hover:bg-accent transition-colors text-left ${
                            selectedBrand?.id === brand.id ? 'bg-accent' : ''
                          }`}
                        >
                          <WebLogo domain={brand.domain} size={20} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{brand.companyName}</p>
                            {brand.domain && (
                              <p className="text-xs text-muted-foreground truncate">{brand.domain}</p>
                            )}
                          </div>
                        </button>
                      ))}
                      
                      {/* Separator */}
                      <div className="border-t border-border my-1"></div>
                    </>
                  ) : (
                    <>
                      {/* No brands message */}
                      <div className="p-3 text-center">
                        <p className="text-sm text-muted-foreground">No brands available</p>
                        <p className="text-xs text-muted-foreground mt-1">Create your first brand below</p>
                      </div>
                      
                      {/* Separator */}
                      <div className="border-t border-border my-1"></div>
                    </>
                  )}
                  
                  {/* Add Brand Option - Always show */}
                  <Link
                    href="/dashboard/add-brand/step-1"
                    onClick={() => setIsBrandDropdownOpen(false)}
                    className="w-full flex items-center space-x-3 p-3 hover:bg-accent transition-colors text-left"
                  >
                    <div className="w-5 h-5 bg-[#000C60] rounded-full flex items-center justify-center flex-shrink-0">
                      <Plus className="h-3 w-3 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#000C60]">Add Brand</p>
                      <p className="text-xs text-muted-foreground">Create a new brand</p>
                    </div>
                  </Link>
                </div>
              )}
            </div>

            {/* Add Brand Button */}
            <Link
              href="/dashboard/add-brand/step-1"
              className="flex items-center space-x-2 bg-[#000C60] text-white px-4 py-2 rounded-xl hover:bg-[#000C60]/90 transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span className="text-sm hidden sm:inline">Add Brand</span>
            </Link>

            {/* Download button - COMMENTED OUT (replaced with Your Brands) */}
            {/* <button className="flex items-center space-x-2 bg-gradient-to-r from-[#000C60] to-[#000C60] text-white px-4 py-2 rounded-lg hover:from-[#000C60] hover:to-[#000C60] transition-all shadow-lg shadow-[#000C60]/20">
              <Download className="h-4 w-4" />
              <span className="text-sm hidden sm:inline">Export</span>
            </button> */}
          </div>
        </div>
      </div>

      {/* Mobile Search - Temporarily commented out */}
      {/* <div className="md:hidden mt-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search brands, mentions..."
            className="w-full bg-card border border-border text-foreground pl-10 pr-4 py-2 rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-sm transition-colors"
          />
        </div>
      </div> */}
    </header>
  );
} 