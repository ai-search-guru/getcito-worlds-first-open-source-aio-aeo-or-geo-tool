import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrandContextProvider, useBrandContext } from '@/context/BrandContext';
import { useUserBrands } from '@/hooks/useUserBrands';
import { useAuthContext } from '@/context/AuthContext';

// Mock dependencies
jest.mock('@/hooks/useUserBrands');
jest.mock('@/context/AuthContext');

const mockUseUserBrands = useUserBrands as jest.MockedFunction<typeof useUserBrands>;
const mockUseAuthContext = useAuthContext as jest.MockedFunction<typeof useAuthContext>;

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Test component to access the context
const TestComponent: React.FC = () => {
  const { 
    selectedBrand, 
    selectedBrandId, 
    brands, 
    setSelectedBrandId, 
    loading, 
    error 
  } = useBrandContext();

  return (
    <div>
      <div data-testid="selected-brand-id">{selectedBrandId || 'none'}</div>
      <div data-testid="selected-brand-name">{selectedBrand?.companyName || 'none'}</div>
      <div data-testid="brands-count">{brands.length}</div>
      <div data-testid="loading">{loading ? 'loading' : 'not-loading'}</div>
      <div data-testid="error">{error || 'no-error'}</div>
      <button 
        data-testid="set-brand-button" 
        onClick={() => setSelectedBrandId('brand2')}
      >
        Set Brand 2
      </button>
    </div>
  );
};

// Mock brand data
const mockBrands = [
  {
    id: 'brand1',
    userId: 'user1',
    domain: 'example1.com',
    companyName: 'Company 1',
    shortDescription: 'Test company 1',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    timestamp: 1234567890,
    totalQueries: 10,
    setupComplete: true,
    currentStep: 3,
  },
  {
    id: 'brand2',
    userId: 'user1',
    domain: 'example2.com',
    companyName: 'Company 2',
    shortDescription: 'Test company 2',
    createdAt: '2024-01-02',
    updatedAt: '2024-01-02',
    timestamp: 1234567891,
    totalQueries: 15,
    setupComplete: true,
    currentStep: 3,
  },
];

describe('BrandContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
    
    // Default mock implementations
    mockUseAuthContext.mockReturnValue({
      user: { uid: 'user1' } as any,
      loading: false,
    });
    
    mockUseUserBrands.mockReturnValue({
      brands: mockBrands,
      loading: false,
      error: null,
      refetch: jest.fn(),
    });
  });

  describe('Initial State', () => {
    it('should provide initial context values when no brands are available', () => {
      mockUseUserBrands.mockReturnValue({
        brands: [],
        loading: false,
        error: null,
        refetch: jest.fn(),
      });

      render(
        <BrandContextProvider>
          <TestComponent />
        </BrandContextProvider>
      );

      expect(screen.getByTestId('selected-brand-id')).toHaveTextContent('none');
      expect(screen.getByTestId('selected-brand-name')).toHaveTextContent('none');
      expect(screen.getByTestId('brands-count')).toHaveTextContent('0');
      expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
      expect(screen.getByTestId('error')).toHaveTextContent('no-error');
    });

    it('should auto-select first brand when brands are available', async () => {
      render(
        <BrandContextProvider>
          <TestComponent />
        </BrandContextProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('selected-brand-id')).toHaveTextContent('brand1');
        expect(screen.getByTestId('selected-brand-name')).toHaveTextContent('Company 1');
        expect(screen.getByTestId('brands-count')).toHaveTextContent('2');
      });
    });

    it('should show loading state when brands are loading', () => {
      mockUseUserBrands.mockReturnValue({
        brands: [],
        loading: true,
        error: null,
        refetch: jest.fn(),
      });

      render(
        <BrandContextProvider>
          <TestComponent />
        </BrandContextProvider>
      );

      expect(screen.getByTestId('loading')).toHaveTextContent('loading');
    });

    it('should show error state when there is an error', () => {
      mockUseUserBrands.mockReturnValue({
        brands: [],
        loading: false,
        error: 'Failed to load brands',
        refetch: jest.fn(),
      });

      render(
        <BrandContextProvider>
          <TestComponent />
        </BrandContextProvider>
      );

      expect(screen.getByTestId('error')).toHaveTextContent('Failed to load brands');
    });
  });

  describe('localStorage Integration', () => {
    it('should load selected brand from localStorage on mount', async () => {
      localStorageMock.getItem.mockReturnValue('brand2');

      render(
        <BrandContextProvider>
          <TestComponent />
        </BrandContextProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('selected-brand-id')).toHaveTextContent('brand2');
        expect(screen.getByTestId('selected-brand-name')).toHaveTextContent('Company 2');
      });
    });

    it('should save selected brand to localStorage when changed', async () => {
      const user = userEvent.setup();

      render(
        <BrandContextProvider>
          <TestComponent />
        </BrandContextProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('selected-brand-id')).toHaveTextContent('brand1');
      });

      await user.click(screen.getByTestId('set-brand-button'));

      await waitFor(() => {
        expect(screen.getByTestId('selected-brand-id')).toHaveTextContent('brand2');
        expect(localStorageMock.setItem).toHaveBeenCalledWith('selectedBrandId', 'brand2');
      });
    });

    it('should fallback to first brand if localStorage brand does not exist', async () => {
      localStorageMock.getItem.mockReturnValue('non-existent-brand');

      render(
        <BrandContextProvider>
          <TestComponent />
        </BrandContextProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('selected-brand-id')).toHaveTextContent('brand1');
        expect(localStorageMock.setItem).toHaveBeenCalledWith('selectedBrandId', 'brand1');
      });
    });
  });

  describe('Brand Selection', () => {
    it('should update selected brand when setSelectedBrandId is called', async () => {
      const user = userEvent.setup();

      render(
        <BrandContextProvider>
          <TestComponent />
        </BrandContextProvider>
      );

      // Wait for initial auto-selection
      await waitFor(() => {
        expect(screen.getByTestId('selected-brand-id')).toHaveTextContent('brand1');
      });

      // Change selection
      await user.click(screen.getByTestId('set-brand-button'));

      await waitFor(() => {
        expect(screen.getByTestId('selected-brand-id')).toHaveTextContent('brand2');
        expect(screen.getByTestId('selected-brand-name')).toHaveTextContent('Company 2');
      });
    });

    it('should provide correct selectedBrand object', async () => {
      render(
        <BrandContextProvider>
          <TestComponent />
        </BrandContextProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('selected-brand-name')).toHaveTextContent('Company 1');
      });
    });
  });

  describe('Brand Validation', () => {
    it('should reset selection when selected brand is removed from brands list', async () => {
      const { rerender } = render(
        <BrandContextProvider>
          <TestComponent />
        </BrandContextProvider>
      );

      // Wait for initial selection
      await waitFor(() => {
        expect(screen.getByTestId('selected-brand-id')).toHaveTextContent('brand1');
      });

      // Remove the selected brand from the list
      mockUseUserBrands.mockReturnValue({
        brands: [mockBrands[1]], // Only brand2 remains
        loading: false,
        error: null,
        refetch: jest.fn(),
      });

      rerender(
        <BrandContextProvider>
          <TestComponent />
        </BrandContextProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('selected-brand-id')).toHaveTextContent('brand2');
        expect(screen.getByTestId('selected-brand-name')).toHaveTextContent('Company 2');
      });
    });

    it('should clear selection when all brands are removed', async () => {
      const { rerender } = render(
        <BrandContextProvider>
          <TestComponent />
        </BrandContextProvider>
      );

      // Wait for initial selection
      await waitFor(() => {
        expect(screen.getByTestId('selected-brand-id')).toHaveTextContent('brand1');
      });

      // Remove all brands
      mockUseUserBrands.mockReturnValue({
        brands: [],
        loading: false,
        error: null,
        refetch: jest.fn(),
      });

      rerender(
        <BrandContextProvider>
          <TestComponent />
        </BrandContextProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('selected-brand-id')).toHaveTextContent('none');
        expect(screen.getByTestId('selected-brand-name')).toHaveTextContent('none');
      });
    });
  });

  describe('Server-Side Rendering', () => {
    it('should handle SSR without hydration mismatch', () => {
      // Mock client-side detection as false
      const originalWindow = global.window;
      delete (global as any).window;

      render(
        <BrandContextProvider>
          <TestComponent />
        </BrandContextProvider>
      );

      expect(screen.getByTestId('selected-brand-id')).toHaveTextContent('none');
      expect(screen.getByTestId('loading')).toHaveTextContent('loading');

      // Restore window
      global.window = originalWindow;
    });
  });

  describe('Error Handling', () => {
    it('should throw error when useBrandContext is used outside provider', () => {
      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<TestComponent />);
      }).toThrow('useBrandContext must be used within a BrandContextProvider');

      consoleSpy.mockRestore();
    });
  });

  describe('Integration with useUserBrands', () => {
    it('should pass through brands, loading, and error from useUserBrands', async () => {
      mockUseUserBrands.mockReturnValue({
        brands: mockBrands,
        loading: true,
        error: 'Test error',
        refetch: jest.fn(),
      });

      render(
        <BrandContextProvider>
          <TestComponent />
        </BrandContextProvider>
      );

      expect(screen.getByTestId('brands-count')).toHaveTextContent('2');
      expect(screen.getByTestId('loading')).toHaveTextContent('loading');
      expect(screen.getByTestId('error')).toHaveTextContent('Test error');
    });

    it('should not auto-select brand while brands are loading', async () => {
      mockUseUserBrands.mockReturnValue({
        brands: [],
        loading: true,
        error: null,
        refetch: jest.fn(),
      });

      render(
        <BrandContextProvider>
          <TestComponent />
        </BrandContextProvider>
      );

      expect(screen.getByTestId('selected-brand-id')).toHaveTextContent('none');
      expect(screen.getByTestId('loading')).toHaveTextContent('loading');

      // Simulate brands finishing loading
      act(() => {
        mockUseUserBrands.mockReturnValue({
          brands: mockBrands,
          loading: false,
          error: null,
          refetch: jest.fn(),
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('selected-brand-id')).toHaveTextContent('brand1');
        expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
      });
    });
  });
}); 