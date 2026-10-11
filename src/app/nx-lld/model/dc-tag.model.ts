// The host app's own tag class, copied as-is — the Subsurface dropdown's
// request is an array of these (NxLldService.getSubsurfaces()).
// TODO(host): delete this file and import dcTag from the host instead. The
// three types below are stand-ins for the host's own (not in this repo),
// shaped only from the captured sample request.
export type NFIdentity = number;

export class DataStoreOptions {
  constructor(public getLastest = false, public storeInClient = true) {}
}

export enum TagCategory {
  Unknown = 0
}

export class dcTag {
  constructor(
    public TagID?: number,
    public TagName?: string,
    public ElementTypeID?: NFIdentity,
    public SourceObjectID?: number,
    public ObjectID?: number,
    public IsLazyLoading = false,
    public IsShallowsearch = false,
    public isSelected = false,
    public contextObject?: any,
    public dataStoreOptions: DataStoreOptions = new DataStoreOptions(),
    public dataStoreKey?: string,
    public isRemovable = true,
    public CategoryID: TagCategory = TagCategory.Unknown,
    public ActiveOn?: Date,
    public InActiveOn?: Date,
    public ObjectName?: string,
    public ObjectClassID?: number,
    public SourceClassID?: number,
    public Level?: number,
    public IsWildCard = false,
    public IsDeleted = false,
    // UI specific property
    public isDisabled = false,
    public borderColor = ''
  ) {
    //for client side. //for client side. //for client side?
    if (this.ObjectID) this.dataStoreKey = this.ObjectID.toString();
  }
}
