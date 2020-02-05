#!/usr/bin/env python
# coding: utf-8

import pickle
import json
import warnings
import sys
import pathlib
warnings.filterwarnings("ignore")

filename = 'utils/predictor/finalized_model.sav'
model = pickle.load(open(filename, 'rb'))

urlList = json.loads(sys.argv[1])
url_list_category = [] 

for url in urlList: 
    for key, value in url.items():
        line = {'url': value, 'category': model.predict([value])[0] }
        url_list_category.append(line)

print(json.dumps(url_list_category, indent=4))
sys.stdout.flush()
