#!/usr/bin/env python
# coding: utf-8

import pickle
import json
import warnings
import sys
import os
import pathlib

# Suppress all sklearn warnings
warnings.filterwarnings("ignore")

# Handle sklearn compatibility - comprehensive fix
try:
    import sklearn
    import sklearn.metrics
    
    # Fix the scorer module path issue
    try:
        import sklearn.metrics.scorer
    except ImportError:
        try:
            import sklearn.metrics._scorer as scorer
            sklearn.metrics.scorer = scorer
            sys.modules['sklearn.metrics.scorer'] = scorer
        except ImportError:
            pass
    
    # Additional compatibility fixes
    try:
        from sklearn.externals import joblib
    except ImportError:
        import joblib
        sklearn.externals = type(sys)('externals')
        sklearn.externals.joblib = joblib
        
except ImportError:
    pass

def load_model():
    """Load the ML model with proper error handling"""
    # Get the directory where this script is located
    script_dir = os.path.dirname(os.path.abspath(__file__))
    filename = os.path.join(script_dir, 'finalized_model.sav')
    
    if not os.path.exists(filename):
        print(f"Model file not found at: {filename}", file=sys.stderr)
        return None
    
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            with open(filename, 'rb') as f:
                model = pickle.load(f)
        
        print("Model loaded successfully!", file=sys.stderr)
        return model
        
    except Exception as e:
        print(f"Failed to load model: {str(e)}", file=sys.stderr)
        return None

def classify_url_fallback(url):
    """Simple fallback classification when ML model is unavailable"""
    url_lower = url.lower()
    
    if any(social in url_lower for social in ['facebook', 'twitter', 'instagram', 'linkedin', 'tiktok']):
        return 'Social Media'
    elif any(news in url_lower for news in ['news', 'cnn', 'bbc', 'reuters', 'nytimes']):
        return 'News'
    elif any(shop in url_lower for shop in ['amazon', 'ebay', 'shop', 'store', 'buy']):
        return 'Shopping'
    elif any(work in url_lower for work in ['github', 'stackoverflow', 'docs', 'api']):
        return 'Work/Development'
    elif any(stream in url_lower for stream in ['youtube', 'netflix', 'twitch', 'spotify']):
        return 'Entertainment'
    else:
        return 'General'

# Main execution
if __name__ == "__main__":
    try:
        urlList = json.loads(sys.argv[1])
        print(f"Received {len(urlList)} URLs to classify", file=sys.stderr)
        
        model = load_model()
        
        if model is None:
            print("Using fallback classification (no ML model)", file=sys.stderr)
            # Use fallback classification
            url_list_category = []
            for url in urlList:
                for key, value in url.items():
                    line = {'url': value, 'category': classify_url_fallback(value)}
                    url_list_category.append(line)
        else:
            print("Using ML model classification", file=sys.stderr)
            # Use ML model classification
            url_list_category = []
            for url in urlList:
                for key, value in url.items():
                    try:
                        category = model.predict([value])[0]
                        line = {'url': value, 'category': category}
                    except Exception:
                        # Fallback classification on prediction error
                        line = {'url': value, 'category': classify_url_fallback(value)}
                    url_list_category.append(line)
        
        print(json.dumps(url_list_category, indent=4))
        sys.stdout.flush()
        
    except Exception as e:
        error_response = {
            "error": str(e),
            "message": "URL classification failed"
        }
        print(json.dumps(error_response), file=sys.stderr)
        sys.exit(1)
