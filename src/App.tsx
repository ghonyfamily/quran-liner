import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Upload, 
  Trash2, 
  Copy, 
  Download, 
  ChevronRight, 
  ChevronLeft, 
  Settings2, 
  MapPin, 
  Undo2,
  Maximize,
  Minimize,
  Type,
  Plus,
  Minus,
  ExternalLink,
  Menu,
  X,
  UserPlus,
  Search,
  PenLine,
  Highlighter,
  Bookmark
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { toJpeg } from 'html-to-image';

// Natural dimensions for the Quran page
const NATURAL_WIDTH = 1024;
const NATURAL_HEIGHT = 1656;

// Fixed Mapping Data
const DEFAULT_MAP = [107,214,321,428,535,642,749,856,963,1070,1177,1284,1391,1498,1605];

// Default Highlight Settings
const DEFAULT_HL = { height: 80, offsetY: -90 };

interface PageConfig {
  map?: number[];
  highlight?: {
    height: number;
    offsetY: number;
  };
}

// Page specific overrides
const PAGE_CONFIGS: Record<number, PageConfig> = {
  1: {
    map: [282,370,458,546,634,722,810], // Al-Fatihah
    highlight: { height: 70, offsetY: -75 } 
  },
  2: {
    map: [282,370,458,546,634,722,810], // Al-Baqarah
    highlight: { height: 70, offsetY: -75 } 
  }
};

const getLineCoordsFromY = (yCoords: number[]|undefined): LineCoord[] => {
  const coords = yCoords || DEFAULT_MAP;
  return coords.map((y, i) => ({ id: i + 1, y }));
};

interface LineCoord {
  id: number;
  y: number;
}

interface UnderlineStroke {
  lineId: number;
  startX: number;
  endX: number;
  color: string;
  mode: 'underline' | 'highlight';
}

const COLORS = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Gold', value: '#f59e0b' },
  { name: 'Green', value: '#10b981' },
];

function QuranWorkspace({ isMapperMode = false }: { isMapperMode?: boolean }) {
  const [activeLineIndex, setActiveLineIndex] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'mapping' | 'preview'>(isMapperMode ? 'mapping' : 'preview');
  const [tool, setTool] = useState<'underline' | 'highlight' | 'delete'>('underline');
  const [strokes, setStrokes] = useState<UnderlineStroke[]>([]);
  const [zoom, setZoom] = useState(0.5);
  const [copied, setCopied] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [strokeColor, setStrokeColor] = useState(COLORS[0].value);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > window.innerHeight && window.innerWidth >= 768);
  const [showMarkedPagesModal, setShowMarkedPagesModal] = useState(false);
  const [markedPages, setMarkedPages] = useState<number[]>([]);
  const [fingerCount, setFingerCount] = useState(0);

  // Multi-user state
  const [profiles, setProfiles] = useState<{ id: string, name: string }[]>(() => {
    const saved = localStorage.getItem('quran_profiles');
    return saved ? JSON.parse(saved) : [{ id: 'default', name: 'User Utama' }];
  });
  const [activeProfileId, setActiveProfileId] = useState(() => {
    return localStorage.getItem('quran_active_profile') || 'default';
  });
  const [showProfiles, setShowProfiles] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // Scan for marked pages
  useEffect(() => {
    const scanMarkedPages = () => {
      const marked: number[] = [];
      const prefix = `user_${activeProfileId}_strokes_p`;
      for (let i = 1; i <= 604; i++) {
        const data = localStorage.getItem(`${prefix}${i}`);
        if (data && data !== '[]') {
          marked.push(i);
        }
      }
      setMarkedPages(marked.sort((a, b) => a - b));
    };

    scanMarkedPages();
  }, [activeProfileId, strokes]);

  const [searchQuery, setSearchQuery] = useState('');
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isIdle, setIsIdle] = useState(false);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isReadingMode = false;

  // Sidebar visibility effect for landscape
  useEffect(() => {
    const handleResize = () => {
      const isLandscape = window.innerWidth > window.innerHeight;
      const isTabletOrDesktop = window.innerWidth >= 768;
      if (isLandscape && isTabletOrDesktop) {
        setIsSidebarOpen(true);
      } else {
        setIsSidebarOpen(false);
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize(); // Trigger on mount
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [pageNumber, setPageNumber] = useState(() => {
    const activeId = localStorage.getItem('quran_active_profile') || 'default';
    const saved = localStorage.getItem(`user_${activeId}_last_page`);
    return saved ? parseInt(saved) : 1;
  });
  const [isEditingPage, setIsEditingPage] = useState(false);
  const [tempPageValue, setTempPageValue] = useState('');
  const [image, setImage] = useState<string | null>(null);

  const initialLines = isMapperMode 
    ? Array.from({ length: 15 }, (_, i) => ({ id: i + 1, y: 0 }))
    : getLineCoordsFromY(PAGE_CONFIGS[pageNumber]?.map);

  const [lines, setLines] = useState<LineCoord[]>(initialLines);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const isDragging = useRef(false);
  const lastPinchDist = useRef<number | null>(null);
  const lastPinchCenter = useRef<{ x: number, y: number } | null>(null);
  const touchStartPos = useRef<{ x: number, y: number } | null>(null);
  const lastMousePos = useRef<{ x: number, y: number } | null>(null);
  const interactionStartTime = useRef<number>(0);
  const interactionMode = useRef<'pending' | 'drawing' | 'scrolling' | 'erasing'>('pending');

  const SURAHS = [
    { id: 1, name: "Al-Fatihah", page: 1 }, { id: 2, name: "Al-Baqarah", page: 2 },
    { id: 3, name: "Ali 'Imran", page: 50 }, { id: 4, name: "An-Nisa'", page: 77 },
    { id: 5, name: "Al-Ma'idah", page: 106 }, { id: 6, name: "Al-An'am", page: 128 },
    { id: 7, name: "Al-A'raf", page: 151 }, { id: 8, name: "Al-Anfal", page: 177 },
    { id: 9, name: "At-Tawbah", page: 187 }, { id: 10, name: "Yunus", page: 208 },
    { id: 11, name: "Hud", page: 221 }, { id: 12, name: "Yusuf", page: 235 },
    { id: 13, name: "Ar-Ra'd", page: 249 }, { id: 14, name: "Ibrahim", page: 255 },
    { id: 15, name: "Al-Hijr", page: 262 }, { id: 16, name: "An-Nahl", page: 267 },
    { id: 17, name: "Al-Isra'", page: 282 }, { id: 18, name: "Al-Kahf", page: 293 },
    { id: 19, name: "Maryam", page: 305 }, { id: 20, name: "Ta-Ha", page: 312 },
    { id: 21, name: "Al-Anbiya'", page: 322 }, { id: 22, name: "Al-Hajj", page: 332 },
    { id: 23, name: "Al-Mu'minun", page: 342 }, { id: 24, name: "An-Nur", page: 350 },
    { id: 25, name: "Al-Furqan", page: 359 }, { id: 26, name: "Ash-Shu'ara'", page: 367 },
    { id: 27, name: "An-Naml", page: 377 }, { id: 28, name: "Al-Qasas", page: 385 },
    { id: 29, name: "Al-'Ankabut", page: 396 }, { id: 30, name: "Ar-Rum", page: 404 },
    { id: 31, name: "Luqman", page: 411 }, { id: 32, name: "As-Sajdah", page: 415 },
    { id: 33, name: "Al-Ahzab", page: 418 }, { id: 34, name: "Saba'", page: 428 },
    { id: 35, name: "Fatir", page: 434 }, { id: 36, name: "Ya-Sin", page: 440 },
    { id: 37, name: "As-Saffat", page: 446 }, { id: 38, name: "Sad", page: 453 },
    { id: 39, name: "Az-Zumar", page: 458 }, { id: 40, name: "Ghafir", page: 467 },
    { id: 41, name: "Fussilat", page: 477 }, { id: 42, name: "Ash-Shura", page: 483 },
    { id: 43, name: "Az-Zukhruf", page: 489 }, { id: 44, name: "Ad-Dukhan", page: 496 },
    { id: 45, name: "Al-Jathiyah", page: 499 }, { id: 46, name: "Al-Ahqaf", page: 502 },
    { id: 47, name: "Muhammad", page: 507 }, { id: 48, name: "Al-Fath", page: 511 },
    { id: 49, name: "Al-Hujurat", page: 515 }, { id: 50, name: "Qaf", page: 518 },
    { id: 51, name: "Adh-Dhariyat", page: 520 }, { id: 52, name: "At-Tur", page: 523 },
    { id: 53, name: "An-Najm", page: 526 }, { id: 54, name: "Al-Qamar", page: 528 },
    { id: 55, name: "Ar-Rahman", page: 531 }, { id: 56, name: "Al-Waqi'ah", page: 534 },
    { id: 57, name: "Al-Hadid", page: 537 }, { id: 58, name: "Al-Mujadilah", page: 542 },
    { id: 59, name: "Al-Hashr", page: 545 }, { id: 60, name: "Al-Mumtahanah", page: 549 },
    { id: 61, name: "As-Saff", page: 551 }, { id: 62, name: "Al-Jumu'ah", page: 553 },
    { id: 63, name: "Al-Munafiqun", page: 554 }, { id: 64, name: "At-Taghabun", page: 556 },
    { id: 65, name: "At-Talaq", page: 558 }, { id: 66, name: "At-Tahrim", page: 560 },
    { id: 67, name: "Al-Mulk", page: 562 }, { id: 68, name: "Al-Qalam", page: 564 },
    { id: 69, name: "Al-Haqqah", page: 566 }, { id: 70, name: "Al-Ma'arij", page: 568 },
    { id: 71, name: "Nuh", page: 570 }, { id: 72, name: "Al-Jinn", page: 572 },
    { id: 73, name: "Al-Muzzammil", page: 574 }, { id: 74, name: "Al-Muddaththir", page: 575 },
    { id: 75, name: "Al-Qiyamah", page: 577 }, { id: 76, name: "Al-Insan", page: 578 },
    { id: 77, name: "Al-Mursalat", page: 580 }, { id: 78, name: "An-Naba'", page: 582 },
    { id: 79, name: "An-Nazi'at", page: 583 }, { id: 80, name: "Abasa", page: 585 },
    { id: 81, name: "At-Takwir", page: 586 }, { id: 82, name: "Al-Infitar", page: 587 },
    { id: 83, name: "Al-Mutaffifin", page: 587 }, { id: 84, name: "Al-Inshiqaq", page: 589 },
    { id: 85, name: "Al-Buruj", page: 590 }, { id: 86, name: "At-Tariq", page: 591 },
    { id: 87, name: "Al-A'la", page: 591 }, { id: 88, name: "Al-Ghashiyah", page: 592 },
    { id: 89, name: "Al-Fajr", page: 593 }, { id: 90, name: "Al-Balad", page: 594 },
    { id: 91, name: "Ash-Shams", page: 595 }, { id: 92, name: "Al-Layl", page: 595 },
    { id: 93, name: "Ad-Duha", page: 596 }, { id: 94, name: "Ash-Sharh", page: 596 },
    { id: 95, name: "At-Tin", page: 597 }, { id: 96, name: "Al-'Alaq", page: 597 },
    { id: 97, name: "Al-Qadr", page: 598 }, { id: 98, name: "Al-Bayyinah", page: 598 },
    { id: 99, name: "Az-Zalzalah", page: 599 }, { id: 100, name: "Al-'Adiyat", page: 599 },
    { id: 101, name: "Al-Qari'ah", page: 600 }, { id: 102, name: "At-Takathur", page: 600 },
    { id: 103, name: "Al-'Asr", page: 601 }, { id: 104, name: "Al-Humazah", page: 601 },
    { id: 105, name: "Al-Fil", page: 601 }, { id: 106, name: "Quraysh", page: 602 },
    { id: 107, name: "Al-Ma'un", page: 602 }, { id: 108, name: "Al-Kawthar", page: 602 },
    { id: 109, name: "Al-Kafirun", page: 603 }, { id: 110, name: "An-Nasr", page: 603 },
    { id: 111, name: "Al-Masad", page: 603 }, { id: 112, name: "Al-Ikhlas", page: 604 },
    { id: 113, name: "Al-Falaq", page: 604 }, { id: 114, name: "An-Nas", page: 604 },
  ];

  const [showWelcome, setShowWelcome] = useState(false);

  // User profile effects
  useEffect(() => {
    const hasSeenWelcome = localStorage.getItem('quran_liner_welcome_seen');
    if (!hasSeenWelcome) {
      setShowWelcome(true);
    }
  }, []);

  const closeWelcome = () => {
    localStorage.setItem('quran_liner_welcome_seen', 'true');
    setShowWelcome(false);
  };

  useEffect(() => {
    localStorage.setItem('quran_profiles', JSON.stringify(profiles));
  }, [profiles]);

  useEffect(() => {
    const handleActivity = () => {
      setIsIdle(false);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        setIsIdle(true);
      }, 3000);
    };

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('mousedown', handleActivity);
    window.addEventListener('touchstart', handleActivity);
    window.addEventListener('keydown', handleActivity);
    handleActivity();

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('mousedown', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('quran_active_profile', activeProfileId);
    const savedPage = localStorage.getItem(`user_${activeProfileId}_last_page`);
    if (savedPage) setPageNumber(parseInt(savedPage));
  }, [activeProfileId]);

  // Load strokes from localStorage for current user
  useEffect(() => {
    const key = `user_${activeProfileId}_strokes_p${pageNumber}`;
    const saved = localStorage.getItem(key);
    setStrokes(saved ? JSON.parse(saved) : []);
  }, [pageNumber, activeProfileId]);

  // Save strokes for current user
  const saveStrokes = useCallback((newStrokes: UnderlineStroke[]) => {
    const key = `user_${activeProfileId}_strokes_p${pageNumber}`;
    localStorage.setItem(key, JSON.stringify(newStrokes));
  }, [pageNumber, activeProfileId]);

  const addProfile = () => {
    if (!newUserName.trim()) return;
    const id = Date.now().toString();
    setProfiles(prev => [...prev, { id, name: newUserName.trim() }]);
    setActiveProfileId(id);
    setNewUserName('');
  };

  const deleteProfile = (id: string) => {
    if (profiles.length <= 1 || id === 'default') return;
    setProfiles(prev => prev.filter(p => p.id !== id));
    if (activeProfileId === id) setActiveProfileId('default');
    
    // Cleanup localstorage for this user
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith(`user_${id}_`)) localStorage.removeItem(key);
    });
  };

  const saveProfileName = (id: string) => {
    if (!editingName.trim()) return;
    setProfiles(prev => prev.map(p => p.id === id ? { ...p, name: editingName.trim() } : p));
    setEditingProfileId(null);
    setEditingName('');
  };

  const resetView = (withFullscreen?: boolean) => {
    setOffset({ x: 0, y: 0 });
    const isMobile = window.innerWidth < 1024;
    const headerHeight = isMobile ? 64 : 80;
    const sidebarWidth = (isSidebarOpen && !isMobile) ? 320 : 0;
    
    const availableHeight = window.innerHeight - headerHeight - 40;
    const availableWidth = window.innerWidth - sidebarWidth - 40;
    
    const isLandscape = window.innerWidth > window.innerHeight;
    const heightZoom = availableHeight / NATURAL_HEIGHT;
    const widthZoom = availableWidth / NATURAL_WIDTH;
    
    // On mobile landscape, only fit to width so the user can scroll vertically
    let fitZoom;
    if (isMobile && isLandscape) {
      fitZoom = widthZoom;
    } else {
      // Otherwise use the smaller zoom to ensure it fits both ways
      fitZoom = Math.min(heightZoom, widthZoom);
    }
    
    setZoom(Math.min(1.5, fitZoom));

    // Request fullscreen mode if explicitly requested
    if (withFullscreen === true && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(err => {
        console.warn(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    }
  };

  // Initial Zoom Fit & Orientation Change Reset
  useEffect(() => {
    const handleResize = () => resetView();
    resetView();
    const timeout = setTimeout(handleResize, 100);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timeout);
    };
  }, []);

  // Sync lines and save last page for user
  useEffect(() => {
    if (!isMapperMode) {
      const config = PAGE_CONFIGS[pageNumber];
      setLines(getLineCoordsFromY(config?.map));
    }
    localStorage.setItem(`user_${activeProfileId}_last_page`, pageNumber.toString());
  }, [pageNumber, isMapperMode, activeProfileId]);

  // Handle Page Change
  useEffect(() => {
    const formattedPage = String(pageNumber).padStart(3, '0');
    const url = `https://quran.islam-db.com/data/pages/quranpages_1024/images/page${formattedPage}.png`;
    setImage(url);

    // Pre-load neighboring pages (2 before, 2 after)
    const preloadRange = [-2, -1, 1, 2];
    preloadRange.forEach(offset => {
      const targetPage = pageNumber + offset;
      if (targetPage >= 1 && targetPage <= 604) {
        const preformattedPage = String(targetPage).padStart(3, '0');
        const img = new Image();
        img.src = `https://quran.islam-db.com/data/pages/quranpages_1024/images/page${preformattedPage}.png`;
      }
    });
  }, [pageNumber]);

  const onImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImage(event.target?.result as string);
        setStrokes([]);
      };
      reader.readAsDataURL(file);
    }
  };

  const getNaturalCoords = (clientX: number, clientY: number) => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (clientX - rect.left) * (NATURAL_WIDTH / rect.width);
    const y = (clientY - rect.top) * (NATURAL_HEIGHT / rect.height);
    return { x, y };
  };

  const eraseAt = (lineId: number, x: number) => {
    setStrokes(prev => {
      const filtered = prev.filter(s => {
        if (s.lineId !== lineId) return true;
        const minX = Math.min(s.startX, s.endX);
        const maxX = Math.max(s.startX, s.endX);
        // Small buffer for easier erasing
        return !(x >= minX - 10 && x <= maxX + 10);
      });
      return filtered;
    });
  };


  const handleStart = (clientX: number, clientY: number) => {
    touchStartPos.current = { x: clientX, y: clientY };
    lastMousePos.current = { x: clientX, y: clientY };
    interactionStartTime.current = Date.now();
    isDragging.current = true;
    interactionMode.current = (isReadingMode || isMapperMode) ? 'scrolling' : 'pending';

    if (!image) return;
    const coords = getNaturalCoords(clientX, clientY);
    if (!coords) return;

    if (viewMode === 'mapping' && activeLineIndex !== null) {
      const newLines = [...lines];
      newLines[activeLineIndex].y = Math.round(coords.y);
      setLines(newLines);
    }
  };

  const handleMove = (clientX: number, clientY: number) => {
    if (!isDragging.current || viewMode !== 'preview') return;

    if (interactionMode.current === 'pending' && touchStartPos.current) {
      const dx = clientX - touchStartPos.current.x;
      const dy = clientY - touchStartPos.current.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 12) {
        if (Math.abs(dy) > Math.abs(dx) * 1.2) {
          interactionMode.current = 'scrolling';
        } else {
          if (tool === 'underline' || tool === 'highlight') {
            interactionMode.current = 'drawing';
            const coords = getNaturalCoords(touchStartPos.current.x, touchStartPos.current.y);
            if (coords) {
              const validLines = lines.filter(l => l.y > 0 && l.y >= coords.y);
              if (validLines.length > 0) {
                const targetLine = [...validLines].sort((a, b) => a.y - b.y)[0];
                const newStroke: UnderlineStroke = { 
                  lineId: targetLine.id, 
                  startX: coords.x, 
                  endX: coords.x,
                  color: strokeColor,
                  mode: tool === 'highlight' ? 'highlight' : 'underline'
                };
                setStrokes(prev => [...prev, newStroke]);
              }
            }
          } else if (tool === 'delete') {
            interactionMode.current = 'erasing';
          } else {
            interactionMode.current = 'scrolling';
          }
        }
      }
    }

    if (interactionMode.current === 'scrolling' && lastMousePos.current) {
      const dx = clientX - lastMousePos.current.x;
      const dy = clientY - lastMousePos.current.y;
      setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    } else if (interactionMode.current === 'drawing') {
      const coords = getNaturalCoords(clientX, clientY);
      if (coords) {
        setStrokes(prev => {
          if (prev.length === 0) return prev;
          const last = prev[prev.length - 1];
          return [...prev.slice(0, -1), { ...last, endX: coords.x }];
        });
      }
    } else if (interactionMode.current === 'erasing') {
      const coords = getNaturalCoords(clientX, clientY);
      if (coords) {
        const validLines = lines.filter(l => l.y > 0 && l.y >= coords.y);
        if (validLines.length > 0) {
          const targetLine = [...validLines].sort((a, b) => a.y - b.y)[0];
          eraseAt(targetLine.id, coords.x);
        }
      }
    }

    lastMousePos.current = { x: clientX, y: clientY };
  };

  const handleEnd = (clientX?: number, clientY?: number) => {
    if (isDragging.current) {
      if (interactionMode.current === 'pending' && tool === 'delete' && clientX !== undefined && clientY !== undefined) {
        // Tap to delete
        const coords = getNaturalCoords(clientX, clientY);
        if (coords) {
          const validLines = lines.filter(l => l.y > 0 && l.y >= coords.y);
          if (validLines.length > 0) {
            const targetLine = [...validLines].sort((a, b) => a.y - b.y)[0];
            eraseAt(targetLine.id, coords.x);
          }
        }
      }

      if (interactionMode.current === 'drawing') {
        const currentStrokes = [...strokes];
        const last = currentStrokes[currentStrokes.length - 1];
        if (last && Math.abs(last.startX - last.endX) < 5) {
          currentStrokes.pop();
          setStrokes(currentStrokes);
          saveStrokes(currentStrokes);
        } else {
          saveStrokes(currentStrokes);
        }
      } else if (interactionMode.current === 'erasing' || (interactionMode.current === 'pending' && tool === 'delete')) {
        saveStrokes(strokes);
      }
    }
    isDragging.current = false;
    interactionMode.current = 'pending';
  };

  // Touch Handlers for Pinch Zoom & Panning
  const handleTouchStart = (e: React.TouchEvent) => {
    setFingerCount(e.touches.length);
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      lastPinchDist.current = dist;
      lastPinchCenter.current = { x: centerX, y: centerY };
    } else if (e.touches.length === 1) {
      handleStart(e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    setFingerCount(e.touches.length);
    if (e.touches.length === 2 && lastPinchDist.current !== null && lastPinchCenter.current !== null) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

      // Panning logic
      const dx = centerX - lastPinchCenter.current.x;
      const dy = centerY - lastPinchCenter.current.y;
      setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      lastPinchCenter.current = { x: centerX, y: centerY };

      // Zooming logic
      const delta = dist - lastPinchDist.current;
      if (Math.abs(delta) > 2) {
        setZoom(prev => Math.min(3, Math.max(0.1, prev + (delta > 0 ? 0.02 : -0.02))));
        lastPinchDist.current = dist;
      }
    } else if (e.touches.length === 1) {
      handleMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (viewMode !== 'preview') return;
    // Prevent default browser scroll when over the workspace
    const zoomDelta = -e.deltaY * 0.001;
    setZoom(prev => Math.min(3, Math.max(0.1, prev + zoomDelta)));
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    setFingerCount(e.touches.length);
    lastPinchDist.current = null;
    lastPinchCenter.current = null;
    const touch = e.changedTouches[0];
    handleEnd(touch?.clientX, touch?.clientY);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    handleStart(e.clientX, e.clientY);
  };
  const handleMouseMove = (e: React.MouseEvent) => handleMove(e.clientX, e.clientY);

  const handleImport = () => {
    try {
      const data = JSON.parse(importText);
      if (Array.isArray(data)) {
        const newLines = data.map((val: any, idx: number) => {
          if (typeof val === 'number') return { id: idx + 1, y: val };
          if (val && typeof val.y === 'number') return { id: val.id || idx + 1, y: val.y };
          return { id: idx + 1, y: 0 };
        }).slice(0, 15);
        while (newLines.length < 15) newLines.push({ id: newLines.length + 1, y: 0 });
        setLines(newLines);
      }
      setShowImport(false);
    } catch (e) {
      const numbers = importText.split(/[\s,\n]+/).map(n => parseInt(n)).filter(n => !isNaN(n));
      const newLines = Array.from({ length: 15 }, (_, i) => ({ id: i + 1, y: numbers[i] || 0 }));
      setLines(newLines);
      setShowImport(false);
    }
  };

  const copyToClipboard = () => {
    const data = JSON.stringify(lines, null, 2);
    navigator.clipboard.writeText(data);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadCSV = () => {
    const csvContent = "data:text/csv;charset=utf-8,line,y_coordinate\n" + lines.map(e => `${e.id},${e.y}`).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "quran_line_mapping.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  const currentSurah = [...SURAHS].reverse().find(s => s.page <= pageNumber)?.name || "Al-Fatihah";

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-[#1a1c20] font-sans selection:bg-orange-500/10 overflow-hidden flex flex-col">
      <AnimatePresence>
        <motion.header 
          initial={{ y: -80 }}
          animate={{ y: 0 }}
          exit={{ y: -80 }}
          className="h-16 border-b border-gray-200 flex items-center justify-between px-4 lg:px-6 bg-white z-40 shadow-sm"
        >
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="flex items-center gap-2 lg:gap-3 hover:opacity-80 transition-all active:scale-95"
              >
                <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 shadow-sm">
                  <img src="https://src.puter.site/quran-liner/logo-q-64.png" alt="Logo" className="w-full h-full object-cover" />
                </div>
                <div className="flex flex-col text-left">
                  <h1 className="text-sm font-black tracking-tight uppercase text-gray-900 leading-none">Quran Liner</h1>
                  <p className="text-[10px] font-bold text-orange-600 mt-1 uppercase tracking-wide">{currentSurah}</p>
                </div>
              </button>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl border border-gray-200">
                <button 
                  onClick={() => setPageNumber(prev => Math.max(1, prev - 1))}
                  className="p-1.5 hover:bg-white hover:shadow-sm rounded-lg text-gray-500 transition-all disabled:opacity-30 disabled:hover:bg-transparent"
                  disabled={pageNumber <= 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                
                {isEditingPage ? (
                  <input
                    autoFocus
                    type="text"
                    inputMode="numeric"
                    value={tempPageValue}
                    onChange={(e) => setTempPageValue(e.target.value.replace(/\D/g, ''))}
                    onBlur={() => {
                      const val = parseInt(tempPageValue);
                      if (!isNaN(val) && val >= 1 && val <= 604) {
                        setPageNumber(val);
                      }
                      setIsEditingPage(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = parseInt(tempPageValue);
                        if (!isNaN(val) && val >= 1 && val <= 604) {
                          setPageNumber(val);
                        }
                        setIsEditingPage(false);
                      }
                      if (e.key === 'Escape') {
                        setIsEditingPage(false);
                      }
                    }}
                    className="w-12 text-center text-xs font-black text-orange-600 bg-white border-x border-gray-200 outline-none"
                  />
                ) : (
                  <button 
                    onClick={() => {
                      setTempPageValue(pageNumber.toString());
                      setIsEditingPage(true);
                    }}
                    className="px-2 text-xs font-black text-gray-900 border-x border-gray-200 min-w-[3rem] text-center hover:text-orange-600 transition-colors"
                  >
                    {pageNumber}
                  </button>
                )}

                <button 
                  onClick={() => setPageNumber(prev => Math.min(604, prev + 1))}
                  className="p-1.5 hover:bg-white hover:shadow-sm rounded-lg text-gray-500 transition-all disabled:opacity-30 disabled:hover:bg-transparent"
                  disabled={pageNumber >= 604}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>

                <div className="w-[1px] h-4 bg-gray-200 my-auto mx-1" />

                <button 
                  onClick={() => setShowMarkedPagesModal(true)}
                  className={`p-1.5 hover:bg-white hover:shadow-sm rounded-lg transition-all ${showMarkedPagesModal ? 'text-orange-600 bg-white shadow-sm' : 'text-gray-500'}`}
                  title="Daftar Penanda"
                >
                  <Bookmark className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.header>
      </AnimatePresence>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Mobile Overlays */}
        <AnimatePresence>
          {isSidebarOpen && window.innerWidth < 1024 && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/30 backdrop-blur-[2px] z-40 transition-all duration-300" 
              onClick={() => setIsSidebarOpen(false)}
            />
          )}
        </AnimatePresence>

        {/* Sidebar Left */}
        <AnimatePresence mode="wait">
          {isSidebarOpen && (
            <motion.aside 
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed lg:relative inset-y-0 left-0 w-80 max-w-[85vw] border-r border-gray-200 bg-white shadow-2xl lg:shadow-none z-50 overflow-y-auto flex flex-col"
            >
              <div className="flex-1 p-4 custom-scrollbar overflow-y-auto space-y-6">
                <div className="p-0 border-b border-gray-100 bg-gray-50/50 space-y-4 mb-6 lg:hidden">
                  <div className="flex items-center justify-between px-1 pt-1">
                    <h2 className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Pilih Menu</h2>
                    <button onClick={() => setIsSidebarOpen(false)} className="p-1.5 hover:bg-gray-200 rounded-lg text-gray-400">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

              {isMapperMode ? (
                <>
                  {!image ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-gray-200 rounded-2xl bg-gray-50">
                      <Upload className="w-12 h-12 text-gray-300 mb-4" />
                      <p className="text-sm text-gray-500 mb-4">Upload Halaman Quran</p>
                      <label className="px-4 py-2 bg-orange-600 hover:bg-orange-700 transition-colors rounded-lg text-sm font-medium cursor-pointer text-white shadow-md shadow-orange-500/20">
                        Pilih File
                        <input type="file" className="hidden" accept="image/*" onChange={onImageUpload} />
                      </label>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <section>
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Data Koordinat</h3>
                          <div className="flex gap-1">
                            <button onClick={() => { setImportText(JSON.stringify(lines.map(l => l.y), null, 2)); setShowImport(true); }} className="p-1.5 hover:bg-gray-100 rounded-md text-gray-400 hover:text-orange-600 transition-colors" title="Import Data"><Plus className="w-3.5 h-3.5" /></button>
                            <button onClick={copyToClipboard} className="p-1.5 hover:bg-gray-100 rounded-md text-gray-400 hover:text-gray-900 transition-colors" title="Copy JSON"><Copy className="w-3.5 h-3.5" /></button>
                            <button onClick={downloadCSV} className="p-1.5 hover:bg-gray-100 rounded-md text-gray-400 hover:text-gray-900 transition-colors" title="Download CSV"><Download className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                        
                        <div className="space-y-1.5">
                          {lines.map((line, idx) => (
                            <button
                              key={line.id}
                              onClick={() => { setActiveLineIndex(idx); setViewMode('mapping'); if(window.innerWidth < 1024) setIsSidebarOpen(false); }}
                              className={`w-full group flex items-center justify-between p-3 rounded-xl transition-all border ${activeLineIndex === idx ? 'bg-orange-50 border-orange-200 text-orange-900' : 'bg-gray-50 border-transparent text-gray-600 hover:bg-gray-100'}`}
                            >
                              <div className="flex items-center gap-3">
                                <span className={`text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-md ${activeLineIndex === idx ? 'bg-orange-600 text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-400 group-hover:text-gray-600'}`}>
                                  {line.id}
                                </span>
                                <div className="text-left">
                                  <p className="text-xs font-bold">Baris {line.id}</p>
                                  <p className="text-[10px] font-mono text-gray-400 opacity-80">Y: {line.y || '--'}</p>
                                </div>
                              </div>
                              {activeLineIndex === idx && <div className="w-1.5 h-1.5 bg-orange-600 rounded-full shadow-[0_0_8px_rgba(234,88,12,0.5)]" />}
                            </button>
                          ))}
                        </div>
                      </section>

                      <section className="pt-4 border-t border-gray-100 space-y-2">
                        <button onClick={() => setStrokes([])} className="w-full flex items-center justify-center gap-2 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors rounded-xl text-xs font-medium text-gray-600 border border-gray-200"><Undo2 className="w-4 h-4" />Reset Garis</button>
                        <button onClick={() => { const resetLines = Array.from({ length: 15 }, (_, i) => ({ id: i + 1, y: 0 })); setLines(resetLines); }} className="w-full flex items-center justify-center gap-2 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors rounded-xl text-xs font-medium text-orange-700 border border-gray-200"><MapPin className="w-4 h-4" />Reset Koordinat</button>
                      </section>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-6">
                  <div className="space-y-4">
                    
                    
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input 
                          type="text" 
                          placeholder="Cari surat..." 
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-9 pr-9 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all"
                        />
                        {searchQuery && (
                          <button 
                            onClick={() => setSearchQuery('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-200 rounded-full text-gray-400 transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1 max-h-[45vh] overflow-y-auto custom-scrollbar pr-1">
                      {SURAHS.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase())).map((s) => (
                        <button 
                          key={s.id}
                          onClick={() => {
                            setPageNumber(s.page);
                            setOffset({ x: 0, y: 0 });
                            if(window.innerWidth < 1024) setIsSidebarOpen(false);
                          }}
                          className={`w-full flex items-center justify-between p-3 rounded-xl transition-all border ${pageNumber === s.page ? 'bg-orange-50 border-orange-200 text-orange-900' : 'hover:bg-gray-50 border-transparent text-gray-600'}`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] font-bold text-gray-400 w-5">{s.id}</span>
                            <span className="text-xs font-bold">{s.name}</span>
                          </div>
                          <span className="text-[10px] font-mono text-gray-400">Hal {s.page}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pt-6 border-t border-gray-100 space-y-4">
                    <h3 className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Pengaturan</h3>
                    
                    <button 
                      onClick={() => setShowProfiles(true)}
                      className="w-full flex items-center gap-3 p-3 bg-white hover:bg-gray-50 border border-gray-200 rounded-xl transition-all group shadow-sm"
                    >
                      <div className="w-8 h-8 bg-orange-600 rounded-lg flex items-center justify-center text-xs font-black text-white shadow-sm">
                        {profiles.find(p => p.id === activeProfileId)?.name?.[0] || 'U'}
                      </div>
                      <div className="flex-1 text-left">
                        <p className="text-xs font-black text-gray-900 leading-none">
                          {profiles.find(p => p.id === activeProfileId)?.name || 'User'}
                        </p>
                        <p className="text-[9px] text-gray-500 mt-1 uppercase font-bold tracking-tighter">Ganti User</p>
                      </div>
                      <UserPlus className="w-4 h-4 text-gray-300 group-hover:text-gray-600" />
                    </button>
                  </div>

                  <div className="pt-6 border-t border-gray-100 space-y-4">
                    <div className="space-y-2">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Tentang Aplikasi</h3>
                      <p className="text-[11px] text-gray-500 leading-relaxed">
                        Quran Liner adalah alat bantu digital untuk menandai dan menggaris halaman Mushaf Al-Quran. Dirancang untuk memudahkan proses belajar tajwid, tilawah, dan menghafal.
                      </p>
                    </div>
                    
                    <div className="flex flex-col gap-1">
                      <p className="text-[10px] text-gray-400 font-medium">© 2026 Quran Liner.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
  
  
  
        <AnimatePresence>
        {showWelcome && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={closeWelcome}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8 bg-orange-600 text-white text-center">
                <div className="w-16 h-16 rounded-2xl overflow-hidden mx-auto mb-4">
                  <img src="https://src.puter.site/quran-liner/logo-q-64.png" alt="Logo" className="w-full h-full object-cover" />
                </div>
                <h2 className="text-2xl font-black mb-2">Selamat Datang di Quran Liner</h2>
                <p className="text-orange-100 text-sm leading-relaxed">
                  Alat bantu digital untuk menandai dan menggaris Mushaf Al-Quran dengan presisi.
                </p>
              </div>

              <div className="p-8 space-y-6">
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold flex-shrink-0">1</div>
                    <div>
                      <h4 className="font-bold text-gray-800 text-sm">Pilih Surah & Halaman</h4>
                      <p className="text-xs text-gray-500">Gunakan sidebar untuk mencari surah atau masukkan nomor halaman langsung.</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold flex-shrink-0">2</div>
                    <div>
                      <h4 className="font-bold text-gray-800 text-sm">Gunakan Alat Garis & Stabilo</h4>
                      <p className="text-xs text-gray-500">Tarik dari kanan ke kiri pada baris ayat untuk membuat tanda. Pilih warna yang sesuai.</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold flex-shrink-0">3</div>
                    <div>
                      <h4 className="font-bold text-gray-800 text-sm">Navigasi Halaman</h4>
                      <p className="text-xs text-gray-500">Gunakan dua jari untuk zoom dan geser pada layar sentuh, atau scroll mouse untuk zoom.</p>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={closeWelcome}
                  className="w-full py-4 bg-orange-600 hover:bg-orange-700 text-white font-black rounded-2xl transition-all shadow-lg shadow-orange-500/20 active:scale-95"
                >
                  Ayo Mulai
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

        <main 
          className="flex-1 bg-[#f0f2f5] relative overflow-hidden p-4 lg:p-4 custom-scrollbar flex justify-center items-start shadow-inner touch-none"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={(e) => handleEnd(e.clientX, e.clientY)}
          onMouseLeave={() => handleEnd()}
          onWheel={handleWheel}
          onDragStart={(e) => e.preventDefault()}
        >
          {image ? (
            <div 
              ref={containerRef}
              className="relative shadow-2xl bg-white rounded-sm ring-1 ring-black/5"
              style={{ 
                width: NATURAL_WIDTH * zoom, 
                height: NATURAL_HEIGHT * zoom,
                minWidth: NATURAL_WIDTH * zoom,
                transform: `translate(${offset.x}px, ${offset.y}px)`,
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onDragStart={(e) => e.preventDefault()}
            >
              <svg 
                className="absolute inset-0 pointer-events-none"
                viewBox={`0 0 ${NATURAL_WIDTH} ${NATURAL_HEIGHT}`}
              >
                {viewMode === 'mapping' && lines.map((line, idx) => (
                  <g key={`guide-${line.id}`}>
                    <line x1="0" y1={line.y} x2={NATURAL_WIDTH} y2={line.y} stroke={activeLineIndex === idx ? "#ea580c" : "rgba(0,0,0,0.1)"} strokeWidth={activeLineIndex === idx ? 2 : 1} strokeDasharray={activeLineIndex === idx ? "0" : "4 4"} />
                    <text x="10" y={line.y - 4} fill={activeLineIndex === idx ? "#ea580c" : "rgba(0,0,0,0.4)"} fontSize="12" fontWeight="700" fontFamily="monospace">L.{line.id} (Y:{line.y})</text>
                  </g>
                ))}

                {strokes.map((stroke, idx) => {
                  const line = lines.find(l => l.id === stroke.lineId);
                  if (!line) return null;
                  const isHighlight = stroke.mode === 'highlight';
                  const color = stroke.color;
                  const x = Math.min(stroke.startX, stroke.endX);
                  const w = Math.max(1, Math.abs(stroke.endX - stroke.startX));

                  if (isHighlight) {
                    const hlConfig = PAGE_CONFIGS[pageNumber]?.highlight || DEFAULT_HL;
                    return (
                      <rect 
                        key={`stroke-${idx}`} 
                        x={x} 
                        y={line.y + hlConfig.offsetY} 
                        width={w} 
                        height={hlConfig.height} 
                        fill={color} 
                        fillOpacity="0.4" 
                      />
                    );
                  }

                  return (
                    <line 
                      key={`stroke-${idx}`} 
                      x1={stroke.startX} 
                      y1={line.y + 1} 
                      x2={stroke.endX} 
                      y2={line.y + 1} 
                      stroke={color} 
                      strokeWidth="5" 
                      strokeLinecap="round" 
                    />
                  );
                })}
              </svg>

              <img
                ref={imageRef}
                src={image}
                alt="Quran Page"
                draggable={false}
                referrerPolicy="no-referrer"
                className="w-full h-full block select-none touch-none pointer-events-none"
                style={{ mixBlendMode: 'multiply' }}
              />

              {isMapperMode && (
                <div className="absolute top-4 right-4 flex gap-2">
                  <div className={`px-2 py-1 bg-white/90 shadow-sm backdrop-blur rounded text-[9px] uppercase tracking-widest font-black border ${viewMode === 'mapping' ? 'border-orange-500 text-orange-600' : 'border-gray-300 text-gray-500'}`}>
                    Edit Mode
                  </div>
                </div>
              )}

              {viewMode === 'mapping' && activeLineIndex !== null && (
                <div className="fixed sm:absolute bottom-6 left-1/2 -translate-x-1/2 px-5 py-2.5 bg-orange-600 text-white rounded-full text-[10px] font-black flex items-center gap-2 shadow-xl pointer-events-none whitespace-nowrap z-40">
                  <MapPin className="w-3.5 h-3.5" />
                  TAP BARIS {lines[activeLineIndex].id}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-gray-300">
              <Maximize className="w-16 h-16 mb-4 opacity-10" />
              <p className="text-sm font-bold text-gray-400">Pilih Halaman</p>
            </div>
          )}

          {viewMode === 'preview' && image && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ 
                opacity: (isIdle || fingerCount >= 3) ? 0 : 1, 
                y: (isIdle || fingerCount >= 3) ? 20 : 0,
                pointerEvents: (isIdle || fingerCount >= 3) ? 'none' : 'auto'
              }}
              className="fixed bottom-6 left-1/2 -translate-x-1/2 lg:left-[calc(50%+160px)] z-40 transition-all duration-300"
            >
              <div className="bg-white/95 backdrop-blur-md border border-gray-200 rounded-2xl shadow-2xl p-1.5 flex items-center gap-1.5">
                {/* Tool Switches */}
                <div className="flex bg-gray-100 p-0.5 rounded-lg border border-gray-200">
                  <button
                    onClick={() => setTool('underline')}
                    className={`px-4 py-1.5 rounded-md transition-all flex items-center gap-2 ${tool === 'underline' ? 'bg-white shadow-sm ring-1 ring-black/5 text-orange-600' : 'text-gray-400 hover:text-gray-600'}`}
                    title="Alat Garis"
                  >
                    <PenLine className="w-4 h-4" />
                    <span className="text-[10px] font-black uppercase hidden sm:inline">Garis</span>
                  </button>

                  <button
                    onClick={() => setTool('highlight')}
                    className={`px-4 py-1.5 rounded-md transition-all flex items-center gap-2 ${tool === 'highlight' ? 'bg-white shadow-sm ring-1 ring-black/5 text-orange-600' : 'text-gray-400 hover:text-gray-600'}`}
                    title="Alat Stabilo"
                  >
                    <Highlighter className="w-4 h-4" />
                    <span className="text-[10px] font-black uppercase hidden sm:inline">Stabilo</span>
                  </button>

                  <button
                    onClick={() => setTool('delete')}
                    className={`px-4 py-1.5 rounded-md transition-all flex items-center gap-2 ${tool === 'delete' ? 'bg-white shadow-sm ring-1 ring-black/5 text-red-600' : 'text-gray-400 hover:text-gray-600'}`}
                    title="Hapus Garis"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span className="text-[10px] font-black uppercase hidden sm:inline">Hapus</span>
                  </button>
                </div>

                {/* Color Picks */}
                <div className="flex px-1 items-center gap-1.5">
                  {COLORS.slice(0, 3).map((c) => (
                    <button
                      key={c.value}
                      onClick={() => { 
                        setStrokeColor(c.value); 
                        if (tool === 'delete') setTool('underline'); 
                      }}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${strokeColor === c.value && (tool === 'underline' || tool === 'highlight') ? 'border-orange-500 scale-110 shadow-lg' : 'border-transparent opacity-60 hover:opacity-100'}`}
                      style={{ backgroundColor: c.value }}
                    />
                  ))}
                </div>

                <div className="w-[1px] h-4 bg-gray-200 my-auto mx-1" />

                <button 
                  onClick={() => resetView(true)}
                  className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-orange-600 transition-colors"
                  title="Reset View"
                >
                  <Maximize className="w-5 h-5" />
                </button>
              </div>
            </motion.div>
          )}
        </main>
      </div>

      <AnimatePresence>
        {showProfiles && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <div>
                  <h2 className="text-lg font-black text-gray-900 leading-none">Profil Pengguna</h2>
                  <p className="text-xs text-gray-500 mt-1">Pilih atau Kelola User</p>
                </div>
                <button onClick={() => setShowProfiles(false)} className="p-2 hover:bg-gray-100 rounded-full"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                  {profiles.map((p) => (
                    <div key={p.id} className={`flex items-center gap-3 p-3 rounded-2xl border transition-all ${activeProfileId === p.id ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 border-transparent hover:border-gray-200'}`}>
                      {editingProfileId === p.id ? (
                        <div className="flex-1 flex gap-2">
                          <input 
                            autoFocus
                            type="text" 
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveProfileName(p.id);
                              if (e.key === 'Escape') setEditingProfileId(null);
                            }}
                            className="flex-1 bg-white border border-orange-200 rounded-lg px-3 py-1.5 text-sm outline-none"
                          />
                          <button 
                            onClick={() => saveProfileName(p.id)}
                            className="bg-orange-600 text-white px-3 py-1.5 rounded-lg hover:bg-orange-700 text-[10px] font-black uppercase"
                          >
                            Simpan
                          </button>
                        </div>
                      ) : (
                        <>
                          <button 
                            onClick={() => { setActiveProfileId(p.id); setShowProfiles(false); }}
                            className="flex-1 flex items-center gap-3 text-left"
                          >
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black text-white ${activeProfileId === p.id ? 'bg-orange-600 shadow-md' : 'bg-gray-400'}`}>
                              {p.name[0]}
                            </div>
                            <div>
                              <p className="text-sm font-bold text-gray-900">{p.name}</p>
                              {activeProfileId === p.id && <p className="text-[10px] text-orange-600 font-bold uppercase">Aktif</p>}
                            </div>
                          </button>
                          <div className="flex items-center">
                            <button 
                              onClick={() => {
                                setEditingProfileId(p.id);
                                setEditingName(p.name);
                              }}
                              className="p-2 text-gray-300 hover:text-orange-500 transition-colors"
                              title="Ganti nama"
                            >
                              <Settings2 className="w-4 h-4" />
                            </button>
                            {profiles.length > 1 && p.id !== 'default' && (
                              <button 
                                onClick={() => deleteProfile(p.id)}
                                className="p-2 text-gray-300 hover:text-red-500 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                <div className="pt-4 border-t border-gray-100">
                   <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="Nama user baru..." 
                      value={newUserName}
                      onChange={(e) => setNewUserName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addProfile()}
                      className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-orange-500 transition-colors"
                    />
                    <button 
                      onClick={addProfile}
                      className="p-2.5 bg-gray-900 text-white rounded-xl hover:bg-black transition-colors"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showImport && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <div>
                  <h2 className="text-lg font-black text-gray-900 leading-none">Import</h2>
                  <p className="text-xs text-gray-500 mt-1">JSON atau Daftar Angka</p>
                </div>
                <button onClick={() => setShowImport(false)} className="p-2 hover:bg-gray-100 rounded-full"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6">
                <textarea value={importText} onChange={(e) => setImportText(e.target.value)} className="w-full h-48 bg-gray-50 border border-gray-200 rounded-2xl p-4 font-mono text-sm outline-none focus:border-orange-500 transition-colors" />
                <div className="flex gap-3 mt-6">
                  <button onClick={() => setShowImport(false)} className="flex-1 py-3.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-600 active:scale-95 transition-transform">Batal</button>
                  <button onClick={handleImport} className="flex-1 py-3.5 rounded-xl bg-orange-600 text-white text-sm font-bold shadow-lg shadow-orange-500/20 active:scale-95 transition-transform">Simpan</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {copied && (
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }} className="fixed bottom-8 left-1/2 -translate-x-1/2 lg:left-auto lg:right-8 lg:-translate-x-0 bg-gray-900 text-white px-5 py-3 rounded-2xl text-xs font-bold shadow-2xl z-[70] border border-white/10 flex items-center gap-2">
            <Copy className="w-3.5 h-3.5 text-orange-400" /> JSON BERHASIL DISALIN
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showMarkedPagesModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm" 
              onClick={() => setShowMarkedPagesModal(false)}
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-100 rounded-2xl flex items-center justify-center">
                    <Bookmark className="w-5 h-5 text-orange-600" />
                  </div>
                  <div>
                    <h2 className="text-sm font-black text-gray-900">Daftar Penanda</h2>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Total {markedPages.length} Halaman Terdeteksi</p>
                  </div>
                </div>
                <button onClick={() => setShowMarkedPagesModal(false)} className="p-2 hover:bg-gray-200 rounded-xl text-gray-400 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 p-6 custom-scrollbar overflow-y-auto">
                {markedPages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
                    <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center">
                      <Bookmark className="w-8 h-8 text-gray-200" />
                    </div>
                    <div className="max-w-[240px]">
                      <p className="text-sm font-bold text-gray-900">Belum ada penanda</p>
                      <p className="text-xs text-gray-400 mt-1">Halaman dengan garis bawah atau stabilo akan otomatis muncul di sini.</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {markedPages.map((p) => {
                      const sName = [...SURAHS].reverse().find(s => s.page <= p)?.name || "Al-Fatihah";
                      return (
                        <button
                          key={p}
                          onClick={() => {
                            setPageNumber(p);
                            setOffset({ x: 0, y: 0 });
                            setShowMarkedPagesModal(false);
                          }}
                          className={`flex items-center gap-4 p-4 rounded-2xl border transition-all text-left group ${pageNumber === p ? 'bg-orange-600 border-orange-600 shadow-lg shadow-orange-200' : 'bg-white border-gray-100 hover:border-orange-200 hover:shadow-md'}`}
                        >
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-black transition-colors ${pageNumber === p ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500 group-hover:bg-orange-50 group-hover:text-orange-600'}`}>
                            {p}
                          </div>
                          <div>
                            <p className={`text-sm font-black transition-colors ${pageNumber === p ? 'text-white' : 'text-gray-900'}`}>{sName}</p>
                            <p className={`text-[10px] font-bold uppercase tracking-tight transition-colors ${pageNumber === p ? 'text-white/70' : 'text-gray-400'}`}>Halaman {p}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              
              <div className="p-5 border-t border-gray-100 bg-gray-50/50 flex flex-col items-center">
                <p className="text-[10px] text-gray-400 font-medium text-center leading-relaxed">
                  Menampilkan daftar halaman yang memiliki riwayat anotasi (Underline/Highlighter).
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #f1f5f9; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
        input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        .touch-none { touch-action: none; }
      `}</style>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<QuranWorkspace isMapperMode={false} />} />
        <Route path="/mapper" element={<QuranWorkspace isMapperMode={true} />} />
      </Routes>
    </BrowserRouter>
  );
}
