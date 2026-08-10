import React, { useState, useEffect } from 'react';
import { X, CloudDownload, Loader2, ArrowLeft } from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { cn } from '../../utils/helpers';
import PayloadIcon from './PayloadIcon';
import PayloadName from './PayloadName';

const PayloadDetailPanel = ({ payload, onClose, onInstall, isInstalled, isUpdate, srcUrl, srcId }) => {
  const [detailsHtml, setDetailsHtml] = useState(null);
  const [loading, setLoading] = useState(false);



  useEffect(() => {
    if (!payload?.details_url) return;
    
    // Resolve full URL if relative
    let url = payload.details_url;
    if (!url.startsWith('http')) {
      // If srcUrl is the repo json, resolve relative to that directory
      if (srcUrl) {
        const base = srcUrl.substring(0, srcUrl.lastIndexOf('/') + 1);
        url = base + url;
      }
    }

    const fetchDetails = async () => {
      setLoading(true);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch details');
        const text = await res.text();
        const html = DOMPurify.sanitize(marked.parse(text));
        setDetailsHtml(html);
      } catch (err) {
        setDetailsHtml('<p class="text-red-400">Failed to load details.</p>');
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [payload, srcUrl]);

  if (!payload) return null;

  return (
    <div className="flex flex-col w-full min-h-full animate-in fade-in duration-300">
      
      {/* View Header with Back Button */}
      <div className="flex items-center justify-between mb-8">
        <button 
          onClick={onClose}
          className="flex items-center space-x-2 text-zinc-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-4 py-2 rounded-xl"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="font-bold text-sm uppercase tracking-wider">Back to Repository</span>
        </button>
      </div>

      {/* Header section */}
      <div className="flex flex-col md:flex-row items-start gap-6 border-b border-white/10 pb-8 shrink-0">
          <div className="flex justify-between w-full md:w-auto">
            <PayloadIcon icon={payload.icon} name={payload.filename} className="w-24 h-24 text-4xl shadow-xl" />
          </div>
          
          <div className="flex-1 min-w-0 w-full">
            <div className="flex justify-between items-start">
              <PayloadName path={payload.filename} version={payload.version} className="text-2xl md:text-3xl text-white font-extrabold truncate w-full" />
            </div>
            
            <div className="text-zinc-400 font-medium text-sm mt-1 mb-4 flex items-center gap-2">
              {payload.author && <span className="text-ps-blue">{payload.author}</span>}
              {payload.author && <span>&bull;</span>}
              <span className="opacity-70 truncate">{payload.filename}</span>
            </div>
            
            <button
              onClick={() => onInstall(payload, srcId, srcUrl)}
              className={cn(
                "w-full flex items-center justify-center space-x-3 px-6 py-4 rounded-2xl font-bold text-lg transition-all active:scale-95",
                isUpdate ? "bg-emerald-600 hover:bg-emerald-500 text-white" :
                isInstalled ? "bg-white/10 text-white/50 cursor-not-allowed" :
                "bg-ps-blue hover:bg-ps-blue/80 text-white"
              )}
              disabled={isInstalled && !isUpdate}
            >
              <CloudDownload className="w-5 h-5" />
              <span>
                {isUpdate ? "Update" : isInstalled ? "Installed" : "Install"}
              </span>
            </button>
          </div>
        </div>

        <div className="flex-1 p-6 md:p-8">
          {payload.description && (
            <div className="mb-8">
              <h3 className="text-lg font-bold text-white mb-3">Description</h3>
              <p className="text-zinc-300 leading-relaxed text-base">{payload.description}</p>
            </div>
          )}

          {payload.release_notes && (
            <div className="mb-8">
              <h3 className="text-lg font-bold text-white mb-3">What's New</h3>
              <div className="text-zinc-300 leading-relaxed text-sm whitespace-pre-wrap bg-white/5 p-4 rounded-2xl border border-white/5">
                {payload.release_notes}
              </div>
            </div>
          )}

          {payload.details_url && (
            <div className="mt-8 pt-8 border-t border-white/10">
              <h3 className="text-lg font-bold text-white mb-4">About</h3>
              {loading ? (
                <div className="flex items-center gap-3 text-zinc-500">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Loading details...</span>
                </div>
              ) : detailsHtml ? (
                <div 
                  className="prose prose-invert max-w-none prose-a:text-ps-blue hover:prose-a:text-ps-blue/80 prose-headings:text-white prose-p:text-zinc-300"
                  dangerouslySetInnerHTML={{ __html: detailsHtml }}
                />
              ) : null}
            </div>
          )}
        </div>
    </div>
  );
};

export default PayloadDetailPanel;
