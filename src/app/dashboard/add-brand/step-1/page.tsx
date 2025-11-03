'use client'
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Globe, Search, Sparkles, ArrowRight, AlertCircle, CheckCircle, Building2, Users, Tag, TrendingUp, ExternalLink, RefreshCw, Target } from 'lucide-react';
import { useCompanyInfo } from '@/hooks/useCompanyInfo';

export default function AddBrandStep1(): React.ReactElement {
  const [domain, setDomain] = useState('');
  const [error, setError] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const router = useRouter();
  
  const { 
    companyState, 
    getCompanyInfo,
    clearCompanyInfo
  } = useCompanyInfo();
  
  const companyData = companyState.result;
  const isAnalyzing = companyState.loading;
  const analysisError = companyState.error;

  // Watch for successful company data fetch and navigate to step 2
  useEffect(() => {
    if (companyData && !isAnalyzing && !analysisError) {
      // Store company info in sessionStorage
      sessionStorage.setItem('companyInfo', JSON.stringify(companyData));
      
      // Navigate to step 2
      router.push('/dashboard/add-brand/step-2');
    }
    
    // Handle error case
    if (analysisError && !isAnalyzing) {
      setError(analysisError);
      setIsValidating(false);
    }
  }, [companyData, isAnalyzing, analysisError, router]);

  // Domain validation function
  const validateDomain = (inputDomain: string): { isValid: boolean; cleanDomain: string; error: string } => {
    if (!inputDomain.trim()) {
      return { isValid: false, cleanDomain: '', error: 'Domain is required' };
    }

    // Remove protocols and www
    let cleanDomain = inputDomain.trim().toLowerCase();
    cleanDomain = cleanDomain.replace(/^https?:\/\//, '');
    cleanDomain = cleanDomain.replace(/^www\./, '');
    cleanDomain = cleanDomain.replace(/\/$/, ''); // Remove trailing slash

    // Basic format validation
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
    
    if (!domainRegex.test(cleanDomain)) {
      return { isValid: false, cleanDomain, error: 'Please enter a valid domain (e.g., example.com)' };
    }

    // Check for spaces
    if (cleanDomain.includes(' ')) {
      return { isValid: false, cleanDomain, error: 'Domain cannot contain spaces' };
    }

    // Check for invalid characters
    if (!/^[a-zA-Z0-9.-]+$/.test(cleanDomain)) {
      return { isValid: false, cleanDomain, error: 'Domain contains invalid characters' };
    }

    // Check if it has at least one dot (TLD)
    if (!cleanDomain.includes('.')) {
      return { isValid: false, cleanDomain, error: 'Please include a top-level domain (e.g., .com, .org)' };
    }

    // Check for consecutive dots
    if (cleanDomain.includes('..')) {
      return { isValid: false, cleanDomain, error: 'Domain cannot have consecutive dots' };
    }

    // Check length
    if (cleanDomain.length > 253) {
      return { isValid: false, cleanDomain, error: 'Domain is too long (max 253 characters)' };
    }

    return { isValid: true, cleanDomain, error: '' };
  };

  const handleDomainChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDomain = e.target.value;
    setDomain(newDomain);
    
    // Clear error when user starts typing
    if (error) {
      setError('');
    }
  };

  const handleAnalyzeDomain = async () => {
    setIsValidating(true);
    setError('');

    const validation = validateDomain(domain);
    
    if (!validation.isValid) {
      setError(validation.error);
      setIsValidating(false);
      return;
    }

    try {
      // Store cleaned domain in sessionStorage for next steps
      sessionStorage.setItem('brandDomain', validation.cleanDomain);
      
      // Get company information
      await getCompanyInfo(validation.cleanDomain);
      
      setIsValidating(false);
    } catch (err) {
      setError('Failed to validate domain. Please try again.');
      setIsValidating(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAnalyzeDomain();
    }
  };

  const validation = validateDomain(domain);
  const isValid = validation.isValid;

  return (
    <div className="min-h-screen bg-[#0E353C] flex flex-col">
      {/* Header with Logo */}
      <div className="flex justify-center pt-8 pb-6">
        <div className="flex flex-col items-center space-y-2">
          {/* AI Monitor Logo */}
          <div className="relative w-48 h-12">
            <Image
              src="/getcito-logo-dark.webp"
              alt="AI Monitor Logo"
              width={192}
              height={48}
              className="block dark:hidden w-full h-auto"
              priority
            />
            <Image
              src="/AI-Monitor-Logo-V3-long-dark-themel.png"
              alt="AI Monitor Logo"
              width={192}
              height={48}
              className="hidden dark:block w-full h-auto"
              priority
            />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex justify-center px-4">
        <div className="w-full max-w-2xl">
          {/* Step Indicators */}
          <div className="flex justify-center mb-12">
            <div className="flex items-center space-x-8">
              {/* Step 1 - Active */}
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 bg-[#93E85F] text-black rounded-full flex items-center justify-center text-lg font-semibold mb-2">
                  1
                </div>
                <span className="text-white text-sm font-medium">Domain</span>
              </div>

              {/* Connector */}
              <div className="w-16 h-px bg-[#1a4a54]"></div>

              {/* Step 2 - Inactive */}
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 bg-[#164a54] text-gray-400 rounded-full flex items-center justify-center text-lg font-semibold mb-2">
                  2
                </div>
                <span className="text-gray-400 text-sm">Brand</span>
              </div>

              {/* Connector */}
              <div className="w-16 h-px bg-[#1a4a54]"></div>

              {/* Step 3 - Inactive */}
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 bg-[#164a54] text-gray-400 rounded-full flex items-center justify-center text-lg font-semibold mb-2">
                  3
                </div>
                <span className="text-gray-400 text-sm">Queries</span>
              </div>
            </div>
          </div>

          {/* Main Card */}
          <div className="bg-[#0a2a30] border border-[#1a4a54] rounded-2xl p-8 shadow-lg">
            {/* Welcome Text */}
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-white mb-4">
                Welcome to GetCito
              </h1>
              <p className="text-gray-300 text-lg">
                Let&apos;s create your brand profile starting with your website
              </p>
            </div>

            {/* Domain Input Section */}
            <div className="mb-8">
              <label className="block text-white text-lg font-semibold mb-4">
                Brand Website Domain
              </label>
              
              <div className="relative mb-3">
                <input
                  type="text"
                  value={domain}
                  onChange={handleDomainChange}
                  onKeyPress={handleKeyPress}
                  placeholder="yourbrand.com"
                  className={`w-full bg-[#0E353C] border text-white px-4 py-4 pr-12 rounded-xl focus:outline-none focus:ring-2 text-lg transition-all ${
                    error || analysisError
                      ? 'border-[#FF4D4D] focus:border-[#FF4D4D] focus:ring-[#FF4D4D]/20'
                      : domain && isValid
                      ? 'border-[#93E85F] focus:border-[#93E85F] focus:ring-[#93E85F]/20'
                      : 'border-[#1a4a54] focus:border-[#93E85F] focus:ring-[#93E85F]/20'
                  }`}
                />
                <div className="absolute right-4 top-1/2 transform -translate-y-1/2 flex items-center space-x-2">
                  {domain && !error && !analysisError && isValid && (
                    <CheckCircle className="h-5 w-5 text-[#93E85F]" />
                  )}
                  {(error || analysisError) && (
                    <AlertCircle className="h-5 w-5 text-[#FF4D4D]" />
                  )}
                  <Globe className="h-5 w-5 text-gray-400" />
                </div>
              </div>
              
              {/* Error Messages */}
              {error && (
                <div className="flex items-center space-x-2 mb-3">
                  <AlertCircle className="h-4 w-4 text-[#FF4D4D] flex-shrink-0" />
                  <p className="text-[#FF4D4D] text-sm">{error}</p>
                </div>
              )}
              
              {analysisError && (
                <div className="flex items-center space-x-2 mb-3">
                  <AlertCircle className="h-4 w-4 text-[#FF4D4D] flex-shrink-0" />
                  <p className="text-[#FF4D4D] text-sm">{analysisError}</p>
                </div>
              )}
              
              {/* Success Message */}
              {domain && !error && !analysisError && isValid && (
                <div className="flex items-center space-x-2 mb-3">
                  <CheckCircle className="h-4 w-4 text-[#93E85F] flex-shrink-0" />
                  <p className="text-[#93E85F] text-sm">Valid domain: {validation.cleanDomain}</p>
                </div>
              )}

              <p className="text-gray-300 text-sm">
                Enter your brand&apos;s main website domain (e.g., apple.com, nike.com)
              </p>
              <p className="text-gray-300 text-sm">
                We&apos;ll use AI to research your domain and automatically extract company information for the next step.
              </p>
            </div>

            {/* Analyze Button */}
            <button
              onClick={handleAnalyzeDomain}
              disabled={!domain.trim() || !isValid || isValidating || isAnalyzing}
              className="w-full bg-[#93E85F] hover:bg-[#93E85F]/90 disabled:bg-[#164a54] disabled:text-gray-400 text-black font-semibold py-4 px-6 rounded-xl transition-all duration-200 flex items-center justify-center space-x-2 text-lg"
            >
              {(isValidating || isAnalyzing) ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-black"></div>
                  <span>{isValidating ? 'Validating...' : 'Getting Company Info...'}</span>
                </>
              ) : (
                <>
                  <span>Get Company Information</span>
                  <ArrowRight className="h-5 w-5" />
                </>
              )}
            </button>

          </div>
        </div>
      </div>
    </div>
  );
} 