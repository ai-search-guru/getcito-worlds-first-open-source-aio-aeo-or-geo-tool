import { NextRequest, NextResponse } from 'next/server';
import { getDomainMetadata, type DomainMetadataInput } from '@/lib/domain-metadata';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as DomainMetadataInput;
    
    if (!body.domain) {
      return NextResponse.json(
        { success: false, error: 'Domain is required' },
        { status: 400 }
      );
    }

    console.log('🚀 Starting domain metadata fetch for domain:', body.domain);
    
    const metadata = await getDomainMetadata(body);
    
    console.log('✅ Domain metadata fetched successfully:', {
      title: metadata.title.substring(0, 50) + '...',
      description: metadata.description.substring(0, 100) + '...',
      hasImage: !!metadata.image,
    });
    
    return NextResponse.json({
      success: true,
      data: metadata,
      metadata: {
        timestamp: new Date().toISOString(),
        source: 'html-scraping',
      }
    });

  } catch (error) {
    console.error('❌ Domain metadata API error:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Internal server error' 
      },
      { status: 500 }
    );
  }
} 