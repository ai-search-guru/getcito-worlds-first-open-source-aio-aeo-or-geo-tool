'use client'
import React, { useState } from "react";
import { useAuthContext } from "@/context/AuthContext";
import { Database, Trash2, Download, Upload, AlertTriangle } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import Card from '@/components/shared/Card';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { seedAllData } from '@/firebase/firestore/seedData';

// Admin emails - in production, this would come from environment variables or database
const ADMIN_EMAILS = [
  'admin@example.com',
  'developer@example.com',
  'team@getaimonitor.com',
  'write2avinash007@gmail.com'
  // Add your admin emails here
];

function AdminPage(): React.ReactElement {
  const { user } = useAuthContext();
  const [isSeeding, setIsSeeding] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSeedData = async () => {
    if (!user?.uid) return;
    
    setIsSeeding(true);
    setMessage(null);
    
    try {
      const result = await seedAllData(user.uid);
      if (result.success) {
        setMessage({ type: 'success', text: 'Sample data seeded successfully!' });
      } else {
        setMessage({ type: 'error', text: 'Failed to seed data. Check console for details.' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'An error occurred while seeding data.' });
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <ProtectedRoute 
      requireAdmin={true} 
      adminEmails={ADMIN_EMAILS}
    >
      <DashboardLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Admin Panel</h1>
            <p className="text-muted-foreground">Manage application data and settings</p>
          </div>

          {/* Message */}
          {message && (
            <div className={`p-4 rounded-lg ${
              message.type === 'success' 
                ? 'bg-green-50 border border-green-200 text-green-800' 
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}>
              {message.text}
            </div>
          )}

          {/* Data Management */}
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="p-6">
              <div className="flex items-center space-x-3 mb-4">
                <Database className="h-6 w-6 text-[#000C60]" />
                <h2 className="text-xl font-semibold text-foreground">Database Management</h2>
              </div>
              <p className="text-muted-foreground mb-4">
                Initialize the database with sample data for testing and development.
              </p>
              <button
                onClick={handleSeedData}
                disabled={isSeeding}
                className="flex items-center space-x-2 bg-[#000C60] text-white px-4 py-2 rounded-lg hover:bg-[#000C60]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSeeding ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>Seeding...</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    <span>Seed Sample Data</span>
                  </>
                )}
              </button>
            </Card>

            <Card className="p-6">
              <div className="flex items-center space-x-3 mb-4">
                <Trash2 className="h-6 w-6 text-red-500" />
                <h2 className="text-xl font-semibold text-foreground">Data Cleanup</h2>
              </div>
              <p className="text-muted-foreground mb-4">
                Remove all user data and reset the database to a clean state.
              </p>
              <button
                disabled
                className="flex items-center space-x-2 bg-red-500 text-white px-4 py-2 rounded-lg opacity-50 cursor-not-allowed"
              >
                <Trash2 className="h-4 w-4" />
                <span>Clear All Data</span>
              </button>
              <p className="text-xs text-muted-foreground mt-2">
                Feature coming soon
              </p>
            </Card>
          </div>

          {/* Export/Import */}
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="p-6">
              <div className="flex items-center space-x-3 mb-4">
                <Download className="h-6 w-6 text-[#00B087]" />
                <h2 className="text-xl font-semibold text-foreground">Export Data</h2>
              </div>
              <p className="text-muted-foreground mb-4">
                Export all application data for backup or migration purposes.
              </p>
              <button
                disabled
                className="flex items-center space-x-2 bg-[#00B087] text-white px-4 py-2 rounded-lg opacity-50 cursor-not-allowed"
              >
                <Download className="h-4 w-4" />
                <span>Export Data</span>
              </button>
              <p className="text-xs text-muted-foreground mt-2">
                Feature coming soon
              </p>
            </Card>

            <Card className="p-6">
              <div className="flex items-center space-x-3 mb-4">
                <Upload className="h-6 w-6 text-[#764F94]" />
                <h2 className="text-xl font-semibold text-foreground">Import Data</h2>
              </div>
              <p className="text-muted-foreground mb-4">
                Import data from backup files or external sources.
              </p>
              <button
                disabled
                className="flex items-center space-x-2 bg-[#764F94] text-white px-4 py-2 rounded-lg opacity-50 cursor-not-allowed"
              >
                <Upload className="h-4 w-4" />
                <span>Import Data</span>
              </button>
              <p className="text-xs text-muted-foreground mt-2">
                Feature coming soon
              </p>
            </Card>
          </div>
        </div>
      </DashboardLayout>
    </ProtectedRoute>
  );
}

export default AdminPage; 