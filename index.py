import shapefile, json, collections, sys, time
t=time.time()
r=shapefile.Reader(sys.argv[1],encoding='big5',encodingErrors='replace')
fn=[f[0] for f in r.fields[1:]]
i46=fn.index('AA46'); ik=fn.index('KCNT'); iu=fn.index('UNIT')
idx=collections.defaultdict(list); sect=collections.defaultdict(collections.Counter); units=collections.defaultdict(collections.Counter)
for n,rec in enumerate(r.iterRecords()):
    d=rec[i46]; idx[d].append(n); sect[d][rec[ik]]+=1; units[d][rec[iu]]+=1
json.dump(idx,open(sys.argv[2],'w'))
for d in sorted(idx): print(d,len(idx[d]),dict(units[d]),[s for s,_ in sect[d].most_common(4)])
print('sec',time.time()-t)
