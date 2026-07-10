'use client'
import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import signOut from '@/firebase/auth/signOut';
import { 
  BarChart3, 
  Settings, 
  CreditCard, 
  Search, 
  TrendingUp, 
  Users, 
  Quote, 
  Plus,
  Menu,
  LogOut,
  User,
  Sun,
  Moon,
  Monitor,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useBrandContext } from '@/context/BrandContext';
import { useAuthContext } from '@/context/AuthContext';
import WebLogo from '@/components/shared/WebLogo';

const navigationItems = [
      { name: 'Overview', href: '/dashboard', icon: BarChart3 },
      { name: 'Analytics', href: '/dashboard/analytics', icon: TrendingUp },
  { name: 'Competitors', href: '/dashboard/competitors', icon: Users },
  { name: 'Queries', href: '/dashboard/queries', icon: Search },
  { name: 'Citations', href: '/dashboard/citations', icon: Quote },
  { name: 'Add Brand', href: '/dashboard/add-brand/step-1', icon: Plus },
  { name: 'Billing', href: '/dashboard/billing', icon: CreditCard },
  { name: 'Settings', href: '/dashboard/settings', icon: Settings },
];

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

export default function Sidebar({ isOpen, onToggle }: SidebarProps): React.ReactElement {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme, actualTheme } = useTheme();
  const { user, userProfile, refreshUserProfile } = useAuthContext();
  const { 
    brands, 
    loading: brandsLoading, 
    error: brandsError, 
    selectedBrandId, 
    setSelectedBrandId 
  } = useBrandContext();
  const [isBrandsDropdownOpen, setIsBrandsDropdownOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  // Ensure single brand is selected when only one brand exists
  React.useEffect(() => {
    if (brands.length === 1 && !selectedBrandId) {
      console.log('🎯 Sidebar: Auto-selecting single brand:', brands[0].id, brands[0].companyName);
      setSelectedBrandId(brands[0].id);
    }
  }, [brands, selectedBrandId, setSelectedBrandId]);

  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsBrandsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Note: We intentionally don't add periodic refresh here as it can interfere with query processing
  // Credits are updated manually after API calls in ProcessQueriesButton

  const getThemeIcon = () => {
    switch (theme) {
      case 'light':
        return Sun;
      case 'dark':
        return Moon;
      case 'system':
        return Monitor;
      default:
        return Monitor;
    }
  };

  const cycleTheme = () => {
    const themes = ['system', 'light', 'dark'] as const;
    const currentIndex = themes.indexOf(theme);
    const nextIndex = (currentIndex + 1) % themes.length;
    setTheme(themes[nextIndex]);
  };

  const getThemeLabel = () => {
    switch (theme) {
      case 'light':
        return 'Light';
      case 'dark':
        return 'Dark';
      case 'system':
        return `System (${actualTheme})`;
      default:
        return 'System';
    }
  };

  const handleSignOut = async () => {
    const { result, error } = await signOut();
    
    if (error) {
      console.error('Sign out error:', error);
      return;
    }
    
    // Redirect to sign in page after successful sign out
    router.push('/signin');
  };

  const ThemeIcon = getThemeIcon();

  // Filter out nav items to hide
  const hiddenNavNames = ['Analytics', 'Billing', 'Settings'];
  const visibleNavigationItems = navigationItems.filter(item => !hiddenNavNames.includes(item.name));

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={onToggle}
        className="lg:hidden fixed top-6 left-6 z-50 p-2 rounded-lg bg-card border border-border text-foreground hover:bg-accent transition-colors"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
          onClick={onToggle}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed lg:static inset-y-0 left-0 z-50 w-72 bg-[#0E353C] border-r border-[#1a4a54] transform ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0 transition-transform duration-300 ease-in-out`}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center px-6 py-6">
            <div className="flex items-center justify-center w-full">
              {/* Light theme logo only - TODO: Restore theme-aware logos when implementing theme switching */}
              <div className="relative">
                <Image
                  src="/getcito-logo-dark.webp"
                  alt="AI Monitor Logo"
                  width={160}
                  height={36}
                  style={{ width: 'auto', height: 'auto' }}
                  priority
                  className="h-9 w-auto"
                />
                {/* TODO: Restore dark theme logo when implementing theme switching
                <Image
                  src="/AI-Monitor-Logo-V3-long-dark-themel.png"
                  alt="AI Monitor Logo"
                  width={160}
                  height={36}
                  className="hidden dark:block h-9 w-auto"
                  style={{ width: 'auto', height: 'auto' }}
                  priority
                />
                */}
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-6 py-6 space-y-1 overflow-y-auto">
            {/* User Brands - Always show, handle loading and empty states */}
            {!brandsLoading && (
              <>
                <div className="w-full bg-[#0a2a30] border border-[#1a4a54] rounded-xl mb-6 p-4">
                  <h3 className="text-sm font-medium text-white mb-3">Your Brands</h3>
                  
                  {/* Always show dropdown - regardless of brand count */}
                  <div className="relative" ref={dropdownRef}>
                    {/* Dropdown Button */}
                    <button
                      onClick={() => setIsBrandsDropdownOpen(!isBrandsDropdownOpen)}
                      className="w-full flex items-center space-x-3 p-2 bg-[#0a2a30] rounded-xl border border-[#1a4a54] hover:bg-[#164a54] transition-colors"
                    >
                      {selectedBrandId && brands.length > 0 && (() => {
                        const selected = brands.find(b => b.id === selectedBrandId);
                        return selected ? (
                          <>
                            <WebLogo domain={selected.domain} size={20} />
                            <div className="flex-1 min-w-0 text-left">
                              <p className="text-xs font-medium text-white truncate">{selected.companyName}</p>
                              {selected.domain && (
                                <p className="text-xs text-gray-300 truncate">{selected.domain}</p>
                              )}
                            </div>
                          </>
                        ) : null;
                      })()}
                      {(!selectedBrandId || brands.length === 0) && (
                        <div className="flex-1 text-left">
                          <p className="text-xs font-medium text-gray-300">
                            {brands.length === 0 ? 'No brands available' : 'Select a brand'}
                          </p>
                        </div>
                      )}
                      <div className="flex-shrink-0">
                        {isBrandsDropdownOpen ? (
                          <ChevronUp className="h-4 w-4 text-gray-300" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-gray-300" />
                        )}
                      </div>
                    </button>

                    {/* Dropdown Menu */}
                    {isBrandsDropdownOpen && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-[#0a2a30] border border-[#1a4a54] rounded-xl shadow-lg z-50 max-h-48 overflow-y-auto">
                        {/* Show brands if available */}
                        {brands.length > 0 ? (
                          <>
                            {/* All Brands */}
                            {brands.map((brand) => (
                              <button
                                key={brand.id}
                                onClick={() => {
                                  setSelectedBrandId(brand.id);
                                  setIsBrandsDropdownOpen(false);
                                }}
                                className={`w-full flex items-center space-x-3 p-2 hover:bg-[#164a54] transition-colors text-left ${
                                  selectedBrandId === brand.id ? 'bg-[#164a54]' : ''
                                }`}
                              >
                                <WebLogo domain={brand.domain} size={20} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium text-white truncate">{brand.companyName}</p>
                                  {brand.domain && (
                                    <p className="text-xs text-gray-300 truncate">{brand.domain}</p>
                                  )}
                                </div>
                              </button>
                            ))}
                            
                            {/* Separator */}
                            <div className="border-t border-[#1a4a54] my-1"></div>
                          </>
                        ) : (
                          <>
                            {/* No brands message */}
                            <div className="p-3 text-center">
                              <p className="text-xs text-gray-300">No brands available</p>
                              <p className="text-xs text-gray-300 mt-1">Create your first brand below</p>
                            </div>

                            {/* Separator */}
                            <div className="border-t border-[#1a4a54] my-1"></div>
                          </>
                        )}
                        
                        {/* Add Brand Option - Always show */}
                        <Link
                          href="/dashboard/add-brand/step-1"
                          onClick={() => setIsBrandsDropdownOpen(false)}
                          className="w-full flex items-center space-x-3 p-2 hover:bg-[#164a54] transition-colors text-left rounded-b-xl"
                        >
                          <div className="w-5 h-5 bg-[#00B087] rounded-full flex items-center justify-center flex-shrink-0">
                            <Plus className="h-3 w-3 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-white">Add Brand</p>
                            <p className="text-xs text-gray-300">Create a new brand</p>
                          </div>
                        </Link>
                      </div>
                    )}
                  </div>
                </div>

                {/* Horizontal line - Always show */}
                <div className="border-t border-[#1a4a54] mb-8"></div>
              </>
            )}

            {/* Loading state */}
            {brandsLoading && (
              <>
                <div className="w-full bg-[#0a2a30] border border-[#1a4a54] rounded-xl mb-6 p-4">
                  <h3 className="text-sm font-medium text-white mb-3">Your Brands</h3>
                  <div className="flex items-center space-x-3 p-2 bg-[#0a2a30] rounded-lg border border-[#1a4a54]">
                    <div className="w-5 h-5 bg-[#164a54] rounded-full animate-pulse"></div>
                    <div className="flex-1 min-w-0">
                      <div className="h-3 bg-[#164a54] rounded w-24 mb-1 animate-pulse"></div>
                      <div className="h-2 bg-[#164a54] rounded w-16 animate-pulse"></div>
                    </div>
                  </div>
                </div>

                {/* Horizontal line */}
                <div className="border-t border-[#1a4a54] mb-8"></div>
              </>
            )}
            
            {visibleNavigationItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.name === 'Add Brand' 
                ? pathname.startsWith('/dashboard/add-brand')
                : pathname === item.href;
              
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`group flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                    isActive
                      ? 'bg-[#93E85F] text-black shadow-lg shadow-[#93E85F]/20'
                      : 'text-gray-300 hover:bg-[#164a54] hover:text-white'
                  }`}
                >
                  <Icon className={`h-5 w-5 ${isActive ? 'text-black' : 'text-gray-300 group-hover:text-white'} transition-colors`} />
                  <span className="font-medium">{item.name}</span>
                  {isActive && (
                    <div className="ml-auto w-2 h-2 bg-black rounded-full"></div>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Theme Toggle Section - TODO: Restore when implementing theme switching */}
          {/* 
          <div className="px-4 py-3 border-t border-border">
            <button
              onClick={cycleTheme}
              className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl bg-muted/50 hover:bg-accent transition-all duration-200 group"
              title={`Current theme: ${getThemeLabel()}. Click to cycle.`}
            >
              <div className="p-2 bg-background rounded-lg border border-border group-hover:border-accent transition-colors">
                <ThemeIcon className="h-4 w-4 text-foreground" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-foreground text-sm font-medium">Theme</p>
                <p className="text-muted-foreground text-xs">{getThemeLabel()}</p>
              </div>
              <div className="text-muted-foreground group-hover:text-foreground transition-colors">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          </div>
          */}

          {/* User section */}
          <div className="p-4 border-t border-[#1a4a54]">
            {/* Credits Display */}
            {userProfile && typeof userProfile.credits === 'number' && (
              <div className={`mb-3 px-4 py-2 rounded-xl border ${
                userProfile.credits < 50 
                  ? 'bg-gradient-to-r from-red-50 to-orange-50 border-red-200' 
                  : userProfile.credits < 100
                  ? 'bg-gradient-to-r from-yellow-50 to-orange-50 border-yellow-200'
                  : 'bg-gradient-to-r from-[#000C60]/10 to-[#00B087]/10 border-[#000C60]/20'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <CreditCard className={`h-3 w-3 ${
                      userProfile.credits < 50 
                        ? 'text-red-600' 
                        : userProfile.credits < 100
                        ? 'text-yellow-600'
                        : 'text-[#000C60]'
                    }`} />
                    <span className={`text-xs font-medium ${
                      userProfile.credits < 50 
                        ? 'text-red-600' 
                        : userProfile.credits < 100
                        ? 'text-yellow-600'
                        : 'text-[#000C60]'
                    }`}>Available Credits</span>
                  </div>
                  <span className={`text-sm font-bold ${
                    userProfile.credits < 50 
                      ? 'text-red-600' 
                      : userProfile.credits < 100
                      ? 'text-yellow-600'
                      : 'text-[#000C60]'
                  }`}>{userProfile.credits.toLocaleString()}</span>
                </div>
                {userProfile.credits < 50 && (
                  <div className="mt-1 text-xs text-red-600">
                    ⚠️ Low credits! Consider purchasing more.
                  </div>
                )}
              </div>
            )}
            
            <div className="flex items-center space-x-3 px-4 py-3 rounded-xl bg-[#164a54] border border-[#1a4a54]">
              {userProfile?.photoURL ? (
                <img
                  src={userProfile.photoURL}
                  alt="Profile"
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <div className="w-10 h-10 bg-gradient-to-br from-[#00B087] to-[#00A078] rounded-full flex items-center justify-center">
                  <User className="h-5 w-5 text-white" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">
                  {userProfile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'User'}
                </p>
                <p className="text-gray-300 text-xs truncate">
                  {userProfile?.email || user?.email || 'No email'}
                </p>
              </div>
              <button
                onClick={handleSignOut}
                className="text-gray-300 hover:text-white transition-colors p-1"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
} 