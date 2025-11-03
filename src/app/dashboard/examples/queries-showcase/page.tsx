'use client'
import React, { useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import QueriesOverview from '@/components/features/QueriesOverview';
import QueriesWidget from '@/components/features/QueriesWidget';
import Card from '@/components/shared/Card';
import { Code, Eye, X } from 'lucide-react';

export default function QueriesShowcase(): React.ReactElement {
  const [showModal, setShowModal] = useState(false);
  const [selectedQuery, setSelectedQuery] = useState<any>(null);

  const handleQueryClick = (query: any, result: any) => {
    console.log('Query clicked:', query, result);
    if (result) {
      setSelectedQuery(result);
      setShowModal(true);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground mb-2">Queries Components Showcase</h1>
          <p className="text-muted-foreground">
            Demonstrating the flexibility and reusability of the queries component system
          </p>
        </div>

        {/* Full Variant */}
        <section>
          <div className="flex items-center space-x-2 mb-4">
            <Code className="h-5 w-5 text-[#000C60]" />
            <h2 className="text-xl font-semibold text-foreground">Full Variant</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Complete queries interface with search, filtering, and processing controls
          </p>
          <QueriesOverview 
            variant="full"
            showSearch={true}
            showCategoryFilter={true}
            showProcessButton={true}
            showEyeIcons={true}
            onQueryClick={handleQueryClick}
            className="min-h-[400px]"
          />
        </section>

        {/* Compact and Minimal Variants */}
        <section>
          <div className="flex items-center space-x-2 mb-4">
            <Code className="h-5 w-5 text-[#000C60]" />
            <h2 className="text-xl font-semibold text-foreground">Compact & Minimal Variants</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Smaller versions perfect for dashboards and overview pages
          </p>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Compact */}
            <div>
              <h3 className="text-lg font-medium text-foreground mb-2">Compact</h3>
              <QueriesOverview 
                variant="compact"
                maxQueries={5}
                showProcessButton={true}
                showSearch={false}
                showCategoryFilter={true}
                showEyeIcons={true}
                onViewAll={() => alert('Navigate to full queries page')}
                onQueryClick={handleQueryClick}
              />
            </div>

            {/* Minimal */}
            <div>
              <h3 className="text-lg font-medium text-foreground mb-2">Minimal</h3>
              <QueriesOverview 
                variant="minimal"
                maxQueries={3}
                showProcessButton={false}
                showSearch={false}
                showCategoryFilter={false}
                showEyeIcons={true}
                onQueryClick={handleQueryClick}
              />
            </div>
          </div>
        </section>

        {/* Widget Showcase */}
        <section>
          <div className="flex items-center space-x-2 mb-4">
            <Code className="h-5 w-5 text-[#000C60]" />
            <h2 className="text-xl font-semibold text-foreground">Queries Widget</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Ultra-compact widget perfect for sidebars and small spaces
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <QueriesWidget 
              onViewAll={() => alert('Navigate to queries page')}
            />
            <QueriesWidget 
              onViewAll={() => alert('Navigate to queries page')}
              className="bg-gradient-to-br from-blue-50 to-purple-50 border-blue-200"
            />
            <QueriesWidget 
              onViewAll={() => alert('Navigate to queries page')}
              className="bg-gradient-to-br from-green-50 to-blue-50 border-green-200"
            />
          </div>
        </section>

        {/* Configuration Examples */}
        <section>
          <div className="flex items-center space-x-2 mb-4">
            <Code className="h-5 w-5 text-[#000C60]" />
            <h2 className="text-xl font-semibold text-foreground">Configuration Examples</h2>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Different configurations for specific use cases
          </p>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Search Only */}
            <div>
              <h3 className="text-lg font-medium text-foreground mb-2">Search Only</h3>
              <QueriesOverview 
                variant="compact"
                maxQueries={4}
                showProcessButton={false}
                showSearch={true}
                showCategoryFilter={false}
                showEyeIcons={false}
                onQueryClick={handleQueryClick}
              />
            </div>

            {/* Filter Only */}
            <div>
              <h3 className="text-lg font-medium text-foreground mb-2">Filter Only</h3>
              <QueriesOverview 
                variant="compact"
                maxQueries={4}
                showProcessButton={false}
                showSearch={false}
                showCategoryFilter={true}
                showEyeIcons={true}
                onQueryClick={handleQueryClick}
              />
            </div>
          </div>
        </section>

        {/* Code Examples */}
        <section>
          <div className="flex items-center space-x-2 mb-4">
            <Code className="h-5 w-5 text-[#000C60]" />
            <h2 className="text-xl font-semibold text-foreground">Usage Examples</h2>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-4">
              <h3 className="text-lg font-medium text-foreground mb-2">Dashboard Overview</h3>
              <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
{`<QueriesOverview 
  variant="compact"
  maxQueries={5}
  showSearch={false}
  onViewAll={() => navigate('/queries')}
/>`}
              </pre>
            </Card>

            <Card className="p-4">
              <h3 className="text-lg font-medium text-foreground mb-2">Full Queries Page</h3>
              <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
{`<QueriesOverview 
  variant="full"
  showSearch={true}
  showCategoryFilter={true}
  onQueryClick={openModal}
/>`}
              </pre>
            </Card>

            <Card className="p-4">
              <h3 className="text-lg font-medium text-foreground mb-2">Sidebar Widget</h3>
              <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
{`<QueriesWidget 
  onViewAll={() => navigate('/queries')}
  className="w-64"
/>`}
              </pre>
            </Card>

            <Card className="p-4">
              <h3 className="text-lg font-medium text-foreground mb-2">Specific Brand</h3>
              <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
{`<QueriesOverview 
  brandOverride={specificBrand}
  variant="compact"
  maxQueries={3}
/>`}
              </pre>
            </Card>
          </div>
        </section>

        {/* Table Layout Example */}
        <section>
          <h2 className="text-xl font-semibold text-foreground mb-4">Table Layout</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Comprehensive table view with columns for Platform, Mentions, Citations, and more. Perfect for detailed analysis and data management.
          </p>
          <QueriesOverview 
            variant="full"
            layout="table"
            showSearch={true}
            showCategoryFilter={true}
            showProcessButton={true}
            showEyeIcons={true}
            onQueryClick={(query, result) => {
              alert(`Table view clicked: ${query.query}`);
            }}
          />
        </section>

        {/* Compact Widget Example */}

        {/* Demo Modal */}
        {showModal && selectedQuery && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-background rounded-lg shadow-xl max-w-2xl w-full max-h-[70vh] overflow-hidden">
              <div className="p-4 border-b border-border">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-foreground">Demo Query Result</h3>
                  <button
                    onClick={() => {
                      setShowModal(false);
                      setSelectedQuery(null);
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{selectedQuery.query}</p>
              </div>
              <div className="p-4 overflow-y-auto max-h-[50vh]">
                <div className="space-y-4">
                  {selectedQuery.results.chatgpt && (
                    <div>
                      <h4 className="font-medium text-foreground mb-2">ChatGPT Response</h4>
                      <div className="bg-muted/30 rounded p-3 text-sm">
                        {selectedQuery.results.chatgpt.response || 'No response available'}
                      </div>
                    </div>
                  )}
                  {selectedQuery.results.gemini && (
                    <div>
                      <h4 className="font-medium text-foreground mb-2">Gemini Response</h4>
                      <div className="bg-muted/30 rounded p-3 text-sm">
                        {selectedQuery.results.gemini.response || 'No response available'}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
} 